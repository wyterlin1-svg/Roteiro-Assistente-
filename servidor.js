// Roteirista 40s: servidor com tela de login, sem dependências.
// Acessos na variável USUARIOS="usuario:senha,outro:senha2".
// As senhas viram hash scrypt na memória ao ligar; a sessão é um cookie assinado (7 dias).
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const PORTA = Number(process.env.PORT) || 3000;
const PASTA = process.env.PAGINAS || join(import.meta.dirname, "public");
const SEGREDO = process.env.SEGREDO_SESSAO || randomBytes(32).toString("hex");
const DURACAO = 7 * 24 * 3600 * 1000;
const COOKIE = "r40s";
// Dados de cada usuário (histórico, resultados dos Reels, aprendizado): um arquivo JSON por pessoa.
const DADOS = process.env.DADOS || join(import.meta.dirname, "dados");
mkdirSync(DADOS, { recursive: true });
const LIMITE_DADOS = 5 * 1024 * 1024;

// ---- Acessos ----
const usuarios = new Map();
for (const par of String(process.env.USUARIOS || "").split(",")) {
  const i = par.indexOf(":");
  if (i < 1) continue;
  const nome = par.slice(0, i).trim().toLowerCase(), sal = randomBytes(16);
  usuarios.set(nome, { sal, hash: scryptSync(par.slice(i + 1), sal, 64) });
}
if (!usuarios.size) {
  console.error('ERRO: defina USUARIOS no formato "usuario:senha,outro:senha2"');
  process.exit(1);
}
delete process.env.USUARIOS;

function conferir(nome, senha) {
  const u = usuarios.get(String(nome).trim().toLowerCase());
  // Sem usuário, calcula mesmo assim para não revelar quem existe pelo tempo de resposta.
  const hash = scryptSync(String(senha), u ? u.sal : Buffer.alloc(16), 64);
  return !!u && timingSafeEqual(hash, u.hash);
}

// ---- Sessão ----
const assinar = (t) => createHmac("sha256", SEGREDO).update(t).digest("base64url");
const criarToken = (nome) => {
  const corpo = `${Buffer.from(nome).toString("base64url")}.${Date.now() + DURACAO}`;
  return `${corpo}.${assinar(corpo)}`;
};
function lerSessao(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [nome64, expira, ass] = m[1].split(".");
  if (!ass) return null;
  const esperado = Buffer.from(assinar(`${nome64}.${expira}`)), recebido = Buffer.from(ass);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  if (Number(expira) < Date.now()) return null;
  const nome = Buffer.from(nome64, "base64url").toString();
  return usuarios.has(nome) ? nome : null; // removido da lista = sem acesso
}
function cookie(req, valor, idade) {
  const https = req.headers["x-forwarded-proto"] === "https" || process.env.COOKIE_SEGURO === "1";
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${idade}${https ? "; Secure" : ""}`;
}

// ---- Proteção contra força bruta: 5 erros em 15 min bloqueiam o IP por 15 min ----
const erros = new Map();
const JANELA = 15 * 60 * 1000;
const ipDe = (req) => String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
const bloqueado = (ip) => { const e = erros.get(ip); return e && e.n >= 5 && Date.now() - e.desde < JANELA; };
function errou(ip) {
  const e = erros.get(ip);
  if (!e || Date.now() - e.desde > JANELA) erros.set(ip, { n: 1, desde: Date.now() });
  else e.n++;
}

// ---- Páginas ----
const LOGIN = readFileSync(join(PASTA, "login.html"));
const APP = readFileSync(join(PASTA, "index.html"), "utf8");
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Botão de sair, colocado sobre a página do Roteirista só quando servida por aqui.
const comSair = (nome) => APP.replace("</body>", `<a href="/sair" id="sair-sessao" style="position:fixed;z-index:10;right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));font:600 13px var(--f-body,system-ui);color:var(--fg,#16141f);background:var(--surface,#fff);border:1px solid var(--line,#dcdbe6);border-radius:99px;padding:8px 14px;text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.08)">${esc(nome)} · Sair</a>\n</body>`);

const SEGURANCA = { "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN", "referrer-policy": "same-origin", "cache-control": "no-store" };
function enviar(res, status, corpo, extra = {}) {
  res.writeHead(status, { ...SEGURANCA, ...extra });
  res.end(corpo);
}
const ir = (res, para, extra = {}) => enviar(res, 303, "", { location: para, ...extra });

const arquivoDe = (nome) => join(DADOS, Buffer.from(nome).toString("hex") + ".json");
function lerDados(nome) {
  try { return readFileSync(arquivoDe(nome), "utf8"); } catch { return "{}"; }
}
function gravarDados(nome, texto) {
  const destino = arquivoDe(nome), tmp = destino + ".tmp";
  writeFileSync(tmp, texto);
  renameSync(tmp, destino); // troca atômica: nunca fica um arquivo pela metade
}
async function lerCorpo(req, limite) {
  let corpo = "";
  for await (const parte of req) {
    corpo += parte;
    if (corpo.length > limite) return null;
  }
  return corpo;
}

async function lerFormulario(req) {
  let corpo = "";
  for await (const parte of req) {
    corpo += parte;
    if (corpo.length > 4000) break;
  }
  return new URLSearchParams(corpo);
}

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://x");
    const quem = lerSessao(req);

    if (pathname === "/saude") return enviar(res, 200, "ok\n", { "content-type": "text/plain" });

    if (pathname === "/entrar" && req.method === "POST") {
      const ip = ipDe(req);
      if (bloqueado(ip)) return ir(res, "/entrar?erro=bloqueado");
      const f = await lerFormulario(req);
      if (!conferir(f.get("usuario") || "", f.get("senha") || "")) {
        errou(ip);
        return ir(res, bloqueado(ip) ? "/entrar?erro=bloqueado" : "/entrar?erro=1");
      }
      erros.delete(ip);
      const nome = String(f.get("usuario")).trim().toLowerCase();
      console.log(`Entrou: ${nome}`);
      return ir(res, "/", { "set-cookie": cookie(req, criarToken(nome), DURACAO / 1000) });
    }
    if (pathname === "/entrar") return quem ? ir(res, "/") : enviar(res, 200, LOGIN, { "content-type": "text/html; charset=utf-8" });
    if (pathname === "/sair") return ir(res, "/entrar?saiu=1", { "set-cookie": cookie(req, "", 0) });

    if (pathname === "/api/dados") {
      const json = { "content-type": "application/json; charset=utf-8" };
      if (!quem) return enviar(res, 401, '{"erro":"sessao"}', json);
      if (req.method === "GET") return enviar(res, 200, lerDados(quem), json);
      if (req.method === "PUT") {
        // Exigir JSON impede que outros sites enviem formulários para cá.
        if (!String(req.headers["content-type"]).startsWith("application/json")) return enviar(res, 415, '{"erro":"json"}', json);
        const corpo = await lerCorpo(req, LIMITE_DADOS);
        if (corpo === null) return enviar(res, 413, '{"erro":"grande demais"}', json);
        let dados;
        try { dados = JSON.parse(corpo); } catch { return enviar(res, 400, '{"erro":"json invalido"}', json); }
        if (!dados || typeof dados !== "object" || Array.isArray(dados)) return enviar(res, 400, '{"erro":"formato"}', json);
        gravarDados(quem, JSON.stringify(dados));
        return enviar(res, 200, '{"ok":true}', json);
      }
      return enviar(res, 405, '{"erro":"metodo"}', json);
    }

    if (!quem) return ir(res, "/entrar");
    if (pathname === "/" || pathname === "/index.html") return enviar(res, 200, comSair(quem), { "content-type": "text/html; charset=utf-8" });
    return ir(res, "/");
  } catch (e) {
    console.error(e);
    enviar(res, 500, "Erro interno", { "content-type": "text/plain; charset=utf-8" });
  }
}).listen(PORTA, () => console.log(`Roteirista 40s na porta ${PORTA}. Acessos: ${[...usuarios.keys()].join(", ")}. Dados em ${DADOS}`));
