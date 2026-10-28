// Roteirista 40s: servidor com tela de login, sem dependências.
// Acessos na variável USUARIOS="usuario:senha,outro:senha2".
// As senhas viram hash scrypt na memória ao ligar; a sessão é um cookie assinado (7 dias).
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const PORTA = Number(process.env.PORT) || 3000;
const PASTA = process.env.PAGINAS || join(import.meta.dirname, "public");
const DURACAO = 7 * 24 * 3600 * 1000;
const COOKIE = "r40s";
// Dados de cada usuário (histórico, resultados dos Reels, aprendizado): um arquivo JSON por pessoa.
const DADOS = process.env.DADOS || join(import.meta.dirname, "dados");
mkdirSync(DADOS, { recursive: true });
// O segredo das sessões fica guardado junto dos dados: reiniciar ou atualizar não desloga ninguém.
function carregarSegredo() {
  if (process.env.SEGREDO_SESSAO) return process.env.SEGREDO_SESSAO;
  const arq = join(DADOS, ".segredo");
  if (!existsSync(arq)) writeFileSync(arq, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(arq, "utf8").trim();
}
const SEGREDO = carregarSegredo();
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
let LOGIN = readFileSync(join(PASTA, "login.html"), "utf8");
let APP = readFileSync(join(PASTA, "index.html"), "utf8");
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Botão de sair, colocado sobre a página do Roteirista só quando servida por aqui.
const comSair = (nome) => APP.replace("</body>", `<a href="/sair" id="sair-sessao" style="position:fixed;z-index:10;right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));font:600 13px var(--f-body,system-ui);color:var(--fg,#16141f);background:var(--surface,#fff);border:1px solid var(--line,#dcdbe6);border-radius:99px;padding:8px 14px;text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.08)">${esc(nome)} · Sair</a>\n</body>`);

const SEGURANCA = { "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN", "referrer-policy": "same-origin", "cache-control": "no-store" };
function enviar(res, status, corpo, extra = {}) {
  res.writeHead(status, { ...SEGURANCA, ...extra });
  res.end(corpo);
}
const ir = (res, para, extra = {}) => enviar(res, 303, "", { location: para, ...extra });

const arquivoDe = (nome, tipo = "") => join(DADOS, Buffer.from(nome).toString("hex") + tipo + ".json");
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

    if (pathname.startsWith("/instagram/") || pathname.startsWith("/api/instagram")) {
      if (!quem && pathname !== "/instagram/retorno") return pathname.startsWith("/api/") ? enviar(res, 401, '{"erro":"sessao"}', { "content-type": "application/json" }) : ir(res, "/entrar");
      // Ações que mudam algo exigem JSON, para outros sites não conseguirem dispará-las.
      if (req.method === "POST" && !String(req.headers["content-type"]).startsWith("application/json")) return enviar(res, 415, '{"erro":"json"}', { "content-type": "application/json" });
      if ((await rotasInstagram(req, res, pathname, quem)) !== false) return;
    }

    if (!quem) return ir(res, "/entrar");
    if (pathname === "/" || pathname === "/index.html") return enviar(res, 200, comSair(quem), { "content-type": "text/html; charset=utf-8" });
    return ir(res, "/");
  } catch (e) {
    console.error(e);
    enviar(res, 500, "Erro interno", { "content-type": "text/plain; charset=utf-8" });
  }
}).listen(PORTA, () => console.log(`Roteirista 40s na porta ${PORTA}. Acessos: ${[...usuarios.keys()].join(", ")}. Dados em ${DADOS}`));

// ---- Instagram (API oficial da Meta, login pelo Instagram) ----
// Configure INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET (app em developers.facebook.com).
// O token de cada usuário fica só no servidor, em <dados>/<usuario>.ig.json; nunca vai ao navegador.
const IG_ID = process.env.INSTAGRAM_APP_ID || "";
const IG_SEGREDO = process.env.INSTAGRAM_APP_SECRET || "";
const IG_VERSAO = process.env.INSTAGRAM_API_VERSAO || "v26.0";
const IG_GRAPH = `https://graph.instagram.com/${IG_VERSAO}`;
const IG_ESCOPO = "instagram_business_basic,instagram_business_manage_insights";
const igConfigurado = () => !!(IG_ID && IG_SEGREDO);
const igRetorno = (req) => process.env.INSTAGRAM_REDIRECT_URI || `https://${req.headers["x-forwarded-host"] || req.headers.host}/instagram/retorno`;

function lerJson(arq) { try { return JSON.parse(readFileSync(arq, "utf8")); } catch { return null; } }
function gravarJson(arq, obj) { writeFileSync(arq + ".tmp", JSON.stringify(obj), { mode: 0o600 }); renameSync(arq + ".tmp", arq); }

async function igPedir(url, opcoes) {
  const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new Error(j.error?.message || j.error_message || `Instagram respondeu ${r.status}`);
    e.codigo = j.error?.code;
    throw e;
  }
  return j;
}

// O "state" amarra o retorno do Instagram ao usuário logado e expira em 10 minutos.
const igState = (nome) => { const c = `${Buffer.from(nome).toString("base64url")}.${Date.now() + 600000}`; return `${c}.${assinar(c)}`; };
// Devolve o usuário dono do "state" (assinado pelo servidor), ou null se adulterado ou vencido.
// Assim a volta do Instagram funciona mesmo quando o login acontece no app do Instagram
// e a página volta num navegador sem a sessão do Roteirista.
function igDonoDoState(state) {
  const [n, exp, ass] = String(state).split(".");
  if (!ass || assinar(`${n}.${exp}`) !== ass || Number(exp) < Date.now()) return null;
  const nome = Buffer.from(n, "base64url").toString();
  return usuarios.has(nome) ? nome : null;
}

// Última falha de conexão de cada usuário, para mostrar o motivo no painel.
const igFalhas = new Map();
function igMotivo(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("redirect")) return "O endereço de retorno não confere. No app da Meta, em Configurar login comercial do Instagram, a URI de redirecionamento precisa ser exatamente o endereço de retorno mostrado no painel do Roteirista.";
  if (m.includes("developer role") || m.includes("tester") || m.includes("permission")) return "Esta conta do Instagram ainda não tem acesso ao app. Adicione-a em Funções do app > Testadores do Instagram e aceite o convite no Instagram (Configurações > Apps e sites > Convites de testador).";
  if (m.includes("platform app") || m.includes("client_id") || m.includes("app id") || m.includes("client secret") || m.includes("secret")) return "ID ou chave secreta do app não conferem. Use o ID do app do *Instagram* e a chave secreta do *Instagram* (em API do Instagram > Configurar com login do Instagram), não os do Facebook.";
  if (m.includes("code") && (m.includes("used") || m.includes("expired") || m.includes("invalid"))) return "O código do Instagram expirou ou já foi usado. Clique em Conectar Instagram de novo.";
  if (m.includes("professional") || m.includes("business") || m.includes("creator")) return "A conta precisa ser profissional (criador ou empresa). No Instagram: Configurações > Tipo de conta e ferramentas.";
  return `O Instagram recusou a conexão: ${msg}`;
}

async function igConectar(nome, code, req) {
  const corpo = new URLSearchParams({ client_id: IG_ID, client_secret: IG_SEGREDO, grant_type: "authorization_code", redirect_uri: igRetorno(req), code });
  const curto = await igPedir("https://api.instagram.com/oauth/access_token", { method: "POST", body: corpo });
  const longo = await igPedir(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(IG_SEGREDO)}&access_token=${encodeURIComponent(curto.access_token)}`);
  const perfil = await igPedir(`${IG_GRAPH}/me?fields=user_id,username,followers_count&access_token=${encodeURIComponent(longo.access_token)}`);
  gravarJson(arquivoDe(nome, ".ig"), { token: longo.access_token, expira: Date.now() + (longo.expires_in || 5184000) * 1000, renovado: Date.now(), usuario: perfil.username, seguidores: perfil.followers_count ?? null });
}

// Busca os últimos Reels com as métricas que o algoritmo mais pesa.
const IG_METRICAS = ["views", "reach", "likes", "comments", "saved", "shares", "ig_reels_avg_watch_time", "reels_skip_rate"];
async function igMetricas(id, token) {
  for (const lista of [IG_METRICAS, IG_METRICAS.slice(0, 7), ["reach", "likes", "comments", "saved", "shares"]]) {
    try {
      const j = await igPedir(`${IG_GRAPH}/${id}/insights?metric=${lista.join(",")}&access_token=${encodeURIComponent(token)}`);
      return Object.fromEntries((j.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
    } catch (e) {
      if (e.codigo === 190) throw e; // token inválido: não adianta tentar outras listas
    }
  }
  return {};
}
async function igImportar(nome) {
  const arq = arquivoDe(nome, ".ig"), conta = lerJson(arq);
  if (!conta) throw new Error("Instagram não conectado.");
  // Renova o token (vale 60 dias) uma vez por semana, para nunca expirar com o uso.
  if (Date.now() - conta.renovado > 7 * 864e5) {
    try {
      const novo = await igPedir(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(conta.token)}`);
      Object.assign(conta, { token: novo.access_token, expira: Date.now() + novo.expires_in * 1000, renovado: Date.now() });
      gravarJson(arq, conta);
    } catch {}
  }
  const lista = await igPedir(`${IG_GRAPH}/me/media?fields=id,caption,media_product_type,permalink,timestamp,thumbnail_url&limit=50&access_token=${encodeURIComponent(conta.token)}`);
  const reels = (lista.data || []).filter((m) => m.media_product_type === "REELS").slice(0, 40);
  const saida = [];
  for (let i = 0; i < reels.length; i += 5) { // 5 por vez: rápido sem estourar o limite da API
    const lote = await Promise.all(reels.slice(i, i + 5).map(async (m) => {
      const x = await igMetricas(m.id, conta.token);
      return {
        id: m.id, legenda: m.caption || "", link: m.permalink, data: m.timestamp, capa: m.thumbnail_url || "",
        views: x.views ?? 0, alcance: x.reach ?? 0, curtidas: x.likes ?? 0, comentarios: x.comments ?? 0,
        salvos: x.saved ?? 0, envios: x.shares ?? 0,
        tempo: Math.round(((x.ig_reels_avg_watch_time ?? 0) / 1000) * 10) / 10, // a API devolve milissegundos
        pulos: x.reels_skip_rate ?? null,
      };
    }));
    saida.push(...lote);
  }
  const pacote = { usuario: conta.usuario, seguidores: conta.seguidores, atualizado: new Date().toISOString(), reels: saida };
  gravarJson(arquivoDe(nome, ".reels"), pacote);
  return pacote;
}

async function rotasInstagram(req, res, pathname, quem) {
  const json = { "content-type": "application/json; charset=utf-8" };
  if (pathname === "/instagram/conectar") {
    if (!igConfigurado()) return ir(res, "/?instagram=nao-configurado");
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({ client_id: IG_ID, redirect_uri: igRetorno(req), response_type: "code", scope: IG_ESCOPO, state: igState(quem) });
    return ir(res, url.toString());
  }
  if (pathname === "/instagram/retorno") {
    const q = new URL(req.url, "http://x").searchParams;
    const dono = igDonoDoState(q.get("state"));
    const destino = (r) => ir(res, (quem ? "/" : "/entrar") + "?instagram=" + r);
    if (!dono || (quem && dono !== quem)) { console.error("Retorno do Instagram com state inválido ou vencido."); return destino("expirou"); }
    if (q.get("error") || !q.get("code")) {
      console.log(`Conexão com o Instagram cancelada (${dono}): ${q.get("error_description") || q.get("error") || "sem código"}`);
      igFalhas.set(dono, igMotivo(q.get("error_description") || "conexão cancelada no Instagram"));
      return destino("cancelado");
    }
    try {
      await igConectar(dono, q.get("code").replace(/#_$/, ""), req);
      igFalhas.delete(dono);
      console.log(`Instagram conectado: ${dono}`);
      await igImportar(dono).catch((e) => console.error(`Importação inicial falhou (${dono}): ${e.message}`));
      return destino("conectado");
    } catch (e) {
      console.error(`Falha ao conectar Instagram (${dono}): ${e.message}`);
      igFalhas.set(dono, igMotivo(e.message));
      return destino("erro");
    }
  }
  if (pathname === "/api/instagram" && req.method === "GET") {
    const conta = lerJson(arquivoDe(quem, ".ig"));
    const dados = lerJson(arquivoDe(quem, ".reels"));
    return enviar(res, 200, JSON.stringify({ configurado: igConfigurado(), conectado: !!conta, usuario: conta?.usuario || null, falha: igFalhas.get(quem) || null, retorno: igRetorno(req), ...(dados && { atualizado: dados.atualizado, seguidores: dados.seguidores, reels: dados.reels }) }), json);
  }
  if (pathname === "/api/instagram/atualizar" && req.method === "POST") {
    try { return enviar(res, 200, JSON.stringify(await igImportar(quem)), json); }
    catch (e) {
      if (e.codigo === 190) { try { unlinkSync(arquivoDe(quem, ".ig")); } catch {} }
      return enviar(res, 502, JSON.stringify({ erro: e.codigo === 190 ? "A conexão com o Instagram expirou. Conecte de novo." : `Não consegui buscar os dados agora: ${e.message}` }), json);
    }
  }
  if (pathname === "/api/instagram/desconectar" && req.method === "POST") {
    for (const t of [".ig", ".reels"]) try { unlinkSync(arquivoDe(quem, t)); } catch {}
    return enviar(res, 200, '{"ok":true}', json);
  }
  return false;
}

// ---- Atualização automática ----
// A cada poucos minutos confere o GitHub. Páginas novas entram na hora, sem reiniciar;
// um servidor novo só é instalado se passar na checagem de sintaxe, e aí o processo
// reinicia sozinho (o Docker o liga de novo). Desligue com ATUALIZACAO=0.
const FONTE = process.env.ATUALIZACAO_URL || "https://raw.githubusercontent.com/wyterlin1-svg/Roteiro-Assistente-/refs/heads/claude/roteirista-40s";
const INTERVALO = Math.max(0.05, Number(process.env.ATUALIZACAO_MINUTOS) || 5) * 60000;
const ESTE_ARQUIVO = join(import.meta.dirname, "servidor.js");

async function buscar(caminho) {
  const r = await fetch(`${FONTE}/${caminho}?v=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.text();
}
function gravar(destino, texto) {
  writeFileSync(destino + ".novo", texto);
  renameSync(destino + ".novo", destino);
}
async function atualizar() {
  try {
    const [pagina, login, servidor] = await Promise.all(["public/index.html", "public/login.html", "servidor.js"].map(buscar));
    // Só aceita arquivos que parecem completos: uma resposta cortada nunca derruba o site.
    if (pagina.includes("</html>") && pagina.includes("Roteirista") && pagina !== APP) {
      gravar(join(PASTA, "index.html"), pagina); APP = pagina; console.log("Atualizado: página do Roteirista");
    }
    if (login.includes("</html>") && login.includes("/entrar") && login !== LOGIN) {
      gravar(join(PASTA, "login.html"), login); LOGIN = login; console.log("Atualizado: tela de login");
    }
    if (servidor !== readFileSync(ESTE_ARQUIVO, "utf8")) {
      const teste = ESTE_ARQUIVO + ".teste.js";
      writeFileSync(teste, servidor);
      if (spawnSync(process.execPath, ["--check", teste]).status !== 0) {
        console.error("Atualização do servidor ignorada: o arquivo novo tem erro.");
        return;
      }
      renameSync(teste, ESTE_ARQUIVO);
      console.log("Atualizado: servidor. Reiniciando para aplicar…");
      setTimeout(() => process.exit(0), 300);
    }
  } catch (e) {
    console.error(`Não consegui verificar atualizações agora (${e.message}). Tento de novo depois.`);
  }
}
if (process.env.ATUALIZACAO !== "0") setInterval(atualizar, INTERVALO).unref();
