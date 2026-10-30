// AI Prompter: servidor com tela de login, sem dependências.
// Acessos na variável USUARIOS="usuario:senha,outro:senha2".
// As senhas viram hash scrypt na memória ao ligar; a sessão é um cookie assinado (7 dias).
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync, readdirSync } from "node:fs";
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
// Botão de sair, colocado sobre a página do AI Prompter só quando servida por aqui.
const comSair = (nome) => APP.replace("</body>", `<a href="/sair" id="sair-sessao" style="position:fixed;z-index:10;right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));font:600 13px var(--f-body,system-ui);color:var(--fg,#e8ebf3);background:var(--surface,#10121b);border:1px solid var(--line,#272a36);border-radius:99px;padding:8px 14px;text-decoration:none;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 8px 24px -10px rgba(0,0,0,.8)">${esc(nome)} · Sair</a>\n</body>`);

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
    const html = { "content-type": "text/html; charset=utf-8" };
    if (pathname === "/privacidade") return enviar(res, 200, paginaPrivacidade(), html);
    if (pathname === "/exclusao-de-dados") {
      if (req.method === "POST") return rotaExclusaoMeta(req, res, "exclusão");
      return enviar(res, 200, paginaExclusao(new URL(req.url, "http://x").searchParams.get("codigo")), html);
    }
    if (pathname === "/instagram/desautorizar" && req.method === "POST") return rotaExclusaoMeta(req, res, "desautorização");

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

    if (pathname === "/api/ia") {
      const json = { "content-type": "application/json; charset=utf-8" };
      if (!quem) return enviar(res, 401, '{"erro":"sessao"}', json);
      if (req.method === "GET") return enviar(res, 200, JSON.stringify({ provedores: iaStatus() }), json);
      if (req.method !== "POST" || !String(req.headers["content-type"]).startsWith("application/json")) return enviar(res, 415, '{"erro":"json"}', json);
      const uso = (iaUsoPorUsuario.get(quem) || []).filter((t) => Date.now() - t < 3600e3);
      if (uso.length >= IA_LIMITE_HORA) return enviar(res, 429, JSON.stringify({ erro: `Limite de ${IA_LIMITE_HORA} pedidos de IA por hora atingido.` }), json);
      let pedido;
      try { pedido = JSON.parse((await lerCorpo(req, 60000)) || "{}"); } catch { return enviar(res, 400, '{"erro":"json invalido"}', json); }
      if (!pedido.prompt || typeof pedido.prompt !== "string") return enviar(res, 400, '{"erro":"prompt"}', json);
      if (!PROVEDORES.length) return enviar(res, 503, '{"erro":"Nenhuma IA configurada no servidor."}', json);
      uso.push(Date.now()); iaUsoPorUsuario.set(quem, uso);
      try { return enviar(res, 200, JSON.stringify(await iaGerar(pedido.prompt)), json); }
      catch (e) { return enviar(res, 503, JSON.stringify({ erro: e.message, falhas: e.falhas }), json); }
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
}).listen(PORTA, () => console.log(`AI Prompter na porta ${PORTA}. Acessos: ${[...usuarios.keys()].join(", ")}. Dados em ${DADOS}. IAs: ${PROVEDORES.map((p) => p.nome).join(", ") || "nenhuma (só motor próprio)"}`));

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
// e a página volta num navegador sem a sessão do AI Prompter.
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
  if (m.includes("redirect")) return "O endereço de retorno não confere. No app da Meta, em Configurar login comercial do Instagram, a URI de redirecionamento precisa ser exatamente o endereço de retorno mostrado no painel do AI Prompter.";
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
  gravarJson(arquivoDe(nome, ".ig"), { token: longo.access_token, expira: Date.now() + (longo.expires_in || 5184000) * 1000, renovado: Date.now(), usuario: perfil.username, seguidores: perfil.followers_count ?? null, ids: [String(perfil.user_id ?? ""), String(curto.user_id ?? "")].filter(Boolean) });
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

// ---- IA gratuita com revezamento entre provedores ----
// Cada provedor com chave configurada entra na fila. Os pedidos são distribuídos entre eles
// (para gastar a cota grátis de todos por igual); o que bater no limite fica em pausa e
// volta sozinho. Se todos estiverem em pausa, a página usa o motor próprio.
// Todos falam o formato de chat da OpenAI; o modelo de cada um pode ser trocado no YAML.
const PROVEDORES = [
  { id: "gemini", nome: "Google Gemini", chave: process.env.GEMINI_API_KEY, url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", modelo: process.env.GEMINI_MODELO || "gemini-2.5-flash" },
  { id: "groq", nome: "Groq", chave: process.env.GROQ_API_KEY, url: "https://api.groq.com/openai/v1/chat/completions", modelo: process.env.GROQ_MODELO || "llama-3.3-70b-versatile" },
  { id: "cerebras", nome: "Cerebras", chave: process.env.CEREBRAS_API_KEY, url: "https://api.cerebras.ai/v1/chat/completions", modelo: process.env.CEREBRAS_MODELO || "llama-3.3-70b" },
  { id: "openrouter", nome: "OpenRouter", chave: process.env.OPENROUTER_API_KEY, url: "https://openrouter.ai/api/v1/chat/completions", modelo: process.env.OPENROUTER_MODELO || "meta-llama/llama-3.3-70b-instruct:free" },
  { id: "mistral", nome: "Mistral", chave: process.env.MISTRAL_API_KEY, url: "https://api.mistral.ai/v1/chat/completions", modelo: process.env.MISTRAL_MODELO || "mistral-small-latest" },
  { id: "github", nome: "GitHub Models", chave: process.env.GITHUB_MODELS_TOKEN, url: "https://models.github.ai/inference/chat/completions", modelo: process.env.GITHUB_MODELO || "openai/gpt-4o-mini" },
].filter((p) => p.chave);
const iaPausa = new Map(); // id -> { ate, motivo }
let iaVez = 0;
const iaUsoPorUsuario = new Map(); // limite por pessoa, para ninguém esgotar a cota de todos
const IA_LIMITE_HORA = Number(process.env.IA_LIMITE_HORA) || 40;

function iaExtrairJson(texto) {
  const t = String(texto).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch {}
  const ini = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  const fim = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (!ini.length || fim <= Math.min(...ini)) throw new Error("a resposta não veio em JSON");
  return JSON.parse(t.slice(Math.min(...ini), fim + 1));
}
// Quanto tempo deixar um provedor descansando, conforme o erro.
function iaTempoDePausa(status, texto, retryAfter) {
  const t = String(texto).toLowerCase();
  if (status === 429) return /day|daily|quota|exceeded|per day|resource_exhausted|credits/.test(t) ? 3600e3 : Math.max(20e3, (Number(retryAfter) || 60) * 1000);
  if (status === 401 || status === 403 || status === 402) return 6 * 3600e3; // chave inválida ou sem crédito
  if ((status === 400 || status === 404) && /model/.test(t)) return 6 * 3600e3; // modelo não existe mais
  return 60e3; // instabilidade passageira
}
async function iaChamar(p, prompt) {
  const r = await fetch(p.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${p.chave}`, ...(p.id === "openrouter" && { "X-Title": "AI Prompter" }) },
    body: JSON.stringify({ model: p.modelo, temperature: 0.9, max_tokens: 3500, messages: [
      { role: "system", content: "Você é o AI Prompter. Responda somente com JSON válido, sem nenhum texto antes ou depois." },
      { role: "user", content: prompt },
    ] }),
    signal: AbortSignal.timeout(60000),
  });
  const texto = await r.text();
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}: ${texto.slice(0, 160)}`), { pausa: iaTempoDePausa(r.status, texto, r.headers.get("retry-after")) });
  let conteudo;
  try { conteudo = JSON.parse(texto).choices?.[0]?.message?.content; } catch {}
  if (!conteudo) throw Object.assign(new Error("resposta vazia"), { pausa: 30e3 });
  return iaExtrairJson(conteudo); // JSON ruim: tenta o próximo provedor, sem pausar este
}
async function iaGerar(prompt) {
  const livres = PROVEDORES.filter((p) => !(iaPausa.get(p.id)?.ate > Date.now()));
  const fila = livres.map((_, i) => livres[(iaVez + i) % livres.length]);
  iaVez++;
  const falhas = [];
  for (const p of fila) {
    try {
      const resultado = await iaChamar(p, prompt);
      iaPausa.delete(p.id);
      return { resultado, provedor: p.nome };
    } catch (e) {
      falhas.push(`${p.nome}: ${e.message}`);
      if (e.pausa) iaPausa.set(p.id, { ate: Date.now() + e.pausa, motivo: e.message.slice(0, 120) });
      console.error(`IA ${p.nome} falhou (${e.message.slice(0, 120)}); tentando a próxima.`);
    }
  }
  throw Object.assign(new Error("Todas as IAs estão no limite agora."), { falhas });
}
function iaStatus() {
  return PROVEDORES.map((p) => {
    const pz = iaPausa.get(p.id);
    const pausado = pz?.ate > Date.now();
    return { nome: p.nome, modelo: p.modelo, disponivel: !pausado, ...(pausado && { volta: new Date(pz.ate).toISOString(), motivo: pz.motivo }) };
  });
}

// ---- Páginas públicas exigidas pela Meta: privacidade e exclusão de dados ----
// Ficam abertas (sem login) porque o revisor da Meta e qualquer usuário precisam acessá-las.
// RESPONSAVEL e CONTATO_EMAIL (opcionais, no YAML) aparecem nas duas páginas.
const RESPONSAVEL = process.env.RESPONSAVEL || "o responsável pelo AI Prompter";
const CONTATO = process.env.CONTATO_EMAIL || "";
const contatoHtml = () => (CONTATO ? `<a href="mailto:${esc(CONTATO)}">${esc(CONTATO)}</a>` : "o contato informado por quem te deu acesso ao AI Prompter");

function paginaPublica(titulo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · AI Prompter</title>
<style>
  :root { --bg: #05060a; --surface: #0f1119; --fg: #e8ebf3; --muted: #8b91a4; --line: rgba(255,255,255,.09); --accent: #5ee7ff; --ok: #3ee08f; color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    background-image: radial-gradient(640px 420px at 10% -10%, rgba(94,231,255,.12), transparent 70%); background-attachment: fixed; }
  main { max-width: 760px; margin: 0 auto; padding: 36px max(20px, env(safe-area-inset-left, 0px)) 60px; }
  .marca { font: 700 13px ui-monospace, Menlo, monospace; color: var(--accent); text-transform: uppercase; letter-spacing: .1em; }
  h1 { font-size: clamp(28px, 5vw, 40px); line-height: 1.1; letter-spacing: -0.02em; margin: 8px 0 6px; }
  h2 { font-size: 20px; margin: 30px 0 8px; }
  .atual { color: var(--muted); font-size: 14px; }
  .caixa { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; margin: 18px 0; }
  .ok { border-color: var(--ok); }
  a { color: var(--accent); }
  li { margin: 6px 0; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; }
</style></head><body><main><div class="marca">AI Prompter</div>${corpo}</main></body></html>`;
}

function paginaPrivacidade() {
  return paginaPublica("Política de Privacidade", `
<h1>Política de Privacidade</h1>
<p class="atual">Última atualização: 29 de outubro de 2026</p>
<p>O AI Prompter é uma ferramenta que cria roteiros de Reels e, se você quiser, analisa o desempenho dos seus Reels no Instagram. Esta política explica quais dados usamos e como. O controlador dos dados é ${esc(RESPONSAVEL)}.</p>
<h2>Dados que coletamos</h2>
<ul>
  <li><b>Acesso ao AI Prompter:</b> seu nome de usuário de acesso. A senha nunca é guardada em texto; ela é transformada em código (hash) na memória do servidor.</li>
  <li><b>Seus roteiros:</b> os roteiros que você cria, os campos que preenche (nicho, público, tom) e os números que você registra manualmente.</li>
  <li><b>Instagram (somente se você conectar):</b> seu nome de usuário, número de seguidores, a lista dos seus Reels (legenda, data, link e miniatura) e as métricas desses Reels (visualizações, alcance, curtidas, comentários, salvamentos, compartilhamentos, tempo médio assistido e taxa de pulos), além do token de acesso concedido por você.</li>
</ul>
<h2>Como usamos</h2>
<p>Usamos esses dados apenas para mostrar a você a análise dos seus Reels e para melhorar as sugestões de roteiros feitas para você. O acesso ao Instagram é somente leitura: o AI Prompter nunca publica, comenta ou envia mensagens.</p>
<h2>Inteligência artificial</h2>
<p>Quando a escrita por IA está ativada, as informações que você digita para criar um roteiro (nicho, detalhes, público, tom e duração) são enviadas a provedores de IA (como Google Gemini, Groq, Cerebras, OpenRouter, Mistral ou GitHub Models) apenas para gerar o texto. Dados e métricas do Instagram não são enviados a esses provedores.</p>
<h2>Compartilhamento</h2>
<p>Não vendemos nem compartilhamos seus dados com terceiros, nem os usamos para publicidade. Os dados ficam armazenados no nosso servidor, hospedado pela Hostinger International Ltd., que atua apenas como provedor de hospedagem.</p>
<h2>Armazenamento e segurança</h2>
<p>Os dados ficam em um servidor protegido, acessível por conexão segura (HTTPS). O token do Instagram fica somente no servidor e nunca é enviado ao navegador. Cada usuário só acessa os próprios dados.</p>
<h2>Por quanto tempo guardamos</h2>
<p>Enquanto sua conta de acesso existir ou até você pedir a exclusão. Ao desconectar o Instagram, o token e os dados do Instagram são apagados na hora.</p>
<h2>Seus direitos (LGPD)</h2>
<p>Você pode pedir acesso, correção ou exclusão dos seus dados a qualquer momento. Veja como em <a href="/exclusao-de-dados">Exclusão de dados</a>.</p>
<h2>Contato</h2>
<p>Fale com ${esc(RESPONSAVEL)} por ${contatoHtml()}.</p>`);
}

const ARQ_EXCLUSOES = join(DADOS, "exclusoes.json");
function paginaExclusao(codigo) {
  const reg = codigo ? (lerJson(ARQ_EXCLUSOES) || {})[codigo] : null;
  const status = codigo ? (reg
    ? `<div class="caixa ok"><b>Pedido de exclusão concluído.</b><br>Código <code>${esc(codigo)}</code>, recebido em ${esc(new Date(reg.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))}. ${reg.apagados ? "Os dados do Instagram ligados a esta conta foram apagados." : "Não havia dados do Instagram guardados para esta conta."}</div>`
    : `<div class="caixa">Não encontramos o código <code>${esc(codigo)}</code>. Confira se ele foi copiado inteiro.</div>`) : "";
  return paginaPublica("Exclusão de dados", `
<h1>Exclusão de dados</h1>
${status}
<p>Você pode apagar os dados que o AI Prompter guarda sobre você de três formas:</p>
<h2>1. Dentro do AI Prompter (na hora)</h2>
<p>Entre no AI Prompter, vá até o painel <b>O que o seu público mostrou</b> e clique em <b>Desconectar</b>. O token e todos os dados do Instagram são apagados imediatamente.</p>
<h2>2. Pelo Instagram</h2>
<p>No Instagram, abra <b>Configurações &gt; Apps e sites</b>, encontre o AI Prompter e toque em <b>Remover</b>. O Instagram nos avisa automaticamente e apagamos os seus dados do Instagram. Você recebe um código de confirmação e pode consultar o status nesta página.</p>
<h2>3. Pedido completo</h2>
<p>Para apagar também sua conta de acesso e todos os roteiros e resultados salvos, envie um pedido para ${contatoHtml()} informando seu usuário. Atendemos em até 15 dias, conforme a LGPD.</p>
<p class="atual">Veja também a <a href="/privacidade">Política de Privacidade</a>.</p>`);
}

// Formato "signed_request" da Meta: assinatura HMAC-SHA256 com a chave secreta do app.
function lerSignedRequest(sr) {
  const [ass, carga] = String(sr || "").split(".");
  if (!ass || !carga || !IG_SEGREDO) return null;
  const esperado = createHmac("sha256", IG_SEGREDO).update(carga).digest("base64url");
  if (esperado.length !== ass.length || !timingSafeEqual(Buffer.from(esperado), Buffer.from(ass))) return null;
  try { return JSON.parse(Buffer.from(carga, "base64url").toString()); } catch { return null; }
}
// Apaga o token e os Reels de quem tiver esse ID do Instagram.
function apagarPorIdInstagram(idIg) {
  let apagados = 0;
  for (const arq of readdirSync(DADOS).filter((f) => f.endsWith(".ig.json"))) {
    const conta = lerJson(join(DADOS, arq));
    if (!conta?.ids?.includes(String(idIg))) continue;
    for (const f of [arq, arq.replace(".ig.json", ".reels.json")]) try { unlinkSync(join(DADOS, f)); } catch {}
    apagados++;
  }
  return apagados;
}
async function rotaExclusaoMeta(req, res, tipo) {
  const corpo = await lerCorpo(req, 20000);
  const dados = lerSignedRequest(new URLSearchParams(corpo || "").get("signed_request"));
  const json = { "content-type": "application/json; charset=utf-8" };
  if (!dados?.user_id) return enviar(res, 400, '{"erro":"signed_request invalido"}', json);
  const apagados = apagarPorIdInstagram(dados.user_id);
  console.log(`Meta pediu ${tipo} do Instagram ${dados.user_id}: ${apagados} conta(s) apagada(s).`);
  if (tipo === "desautorização") return enviar(res, 200, '{"ok":true}', json);
  const codigo = randomBytes(6).toString("hex");
  const registro = lerJson(ARQ_EXCLUSOES) || {};
  registro[codigo] = { data: new Date().toISOString(), apagados };
  gravarJson(ARQ_EXCLUSOES, registro);
  const base = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  return enviar(res, 200, JSON.stringify({ url: `${base}/exclusao-de-dados?codigo=${codigo}`, confirmation_code: codigo }), json);
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
    if (pagina.includes("</html>") && pagina.includes("AI Prompter") && pagina !== APP) {
      gravar(join(PASTA, "index.html"), pagina); APP = pagina; console.log("Atualizado: página do AI Prompter");
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
