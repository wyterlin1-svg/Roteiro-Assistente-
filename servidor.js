// AI Prompter: supervisor. É o processo que o Docker liga e que nunca sai do ar.
// Ele segura a porta e roda o aplicativo (app.js) num processo filho:
// - se o app cair, liga outro na hora;
// - a cada poucos minutos confere o GitHub; se houver versão nova, liga o app novo,
//   espera ele atender e só então desliga o antigo: atualização sem queda.
//   Se a versão nova não ligar, o antigo continua atendendo.
// Este arquivo é pequeno de propósito: quase nunca muda, então o container quase nunca reinicia.
import cluster from "node:cluster";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const DIR = import.meta.dirname;
const APP = join(DIR, "app.js");
const PASTA = process.env.PAGINAS || join(DIR, "public");
const FONTE = process.env.ATUALIZACAO_URL || "https://raw.githubusercontent.com/wyterlin1-svg/Roteiro-Assistente-/refs/heads/claude/roteirista-40s";
const INTERVALO = Math.max(0.05, Number(process.env.ATUALIZACAO_MINUTOS) || 5) * 60000;
const log = (...a) => console.log("[supervisor]", ...a);

// Com memória muito curta (menos de 100 MB), troca um app pelo outro em vez de rodar os dois juntos por um instante.
function memoriaMB() {
  for (const arq of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try { const n = Number(readFileSync(arq, "utf8").trim()); if (n > 0) return n / 2 ** 20; } catch {}
  }
  return Infinity;
}
const SOBREPOR = memoriaMB() >= 100;

async function buscar(caminho) {
  const r = await fetch(`${FONTE}/${caminho}?v=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.text();
}
const valido = (arq) => spawnSync(process.execPath, ["--check", arq]).status === 0;
const ler = (arq) => { try { return readFileSync(arq, "utf8"); } catch { return ""; } };

let atual = null;      // o app que está atendendo
let trocando = false;  // durante uma atualização, a saída do app antigo é esperada
let quedas = [];

function ligar(arquivo) {
  cluster.setupPrimary({ exec: arquivo });
  return cluster.fork();
}

// Liga um app e resolve quando ele estiver atendendo (ou rejeita se ele morrer/travar antes).
function ligarEEsperar(arquivo) {
  return new Promise((ok, falha) => {
    const w = ligar(arquivo);
    const t = setTimeout(() => { w.kill(); falha(new Error("não começou a atender em 30 s")); }, 30000);
    w.once("listening", () => { clearTimeout(t); ok(w); });
    w.once("exit", (c) => { clearTimeout(t); falha(new Error(`saiu com código ${c}`)); });
  });
}

function vigiar(w) {
  atual = w;
  w.on("exit", (codigo, sinal) => {
    if (w !== atual || trocando) return;
    // Queda inesperada: liga outro na hora (com um respiro se estiver caindo em sequência).
    quedas = [...quedas.filter((t) => Date.now() - t < 60000), Date.now()];
    const espera = quedas.length > 3 ? 5000 : 200;
    log(`o app caiu (${sinal || codigo}); religando em ${espera} ms.`);
    setTimeout(() => vigiar(ligar(APP)), espera);
  });
}

function desligarComCalma(w) {
  // Para de receber pedidos novos e termina os que estão em andamento (a IA pode levar ~1 min).
  w.disconnect();
  setTimeout(() => { if (!w.isDead()) w.kill(); }, 90000).unref();
}

async function aplicar(novoApp) {
  const antigo = atual;
  trocando = true;
  try {
    if (!SOBREPOR && antigo) { antigo.kill(); await new Promise((r) => antigo.isDead() ? r() : antigo.once("exit", r)); }
    const w = await ligarEEsperar(novoApp || APP);
    if (novoApp) renameSync(novoApp, APP);
    vigiar(w);
    if (SOBREPOR && antigo) desligarComCalma(antigo);
    log("versão nova no ar, sem queda.");
  } catch (e) {
    log(`a versão nova não ligou (${e.message}); continua a anterior.`);
    if (novoApp) try { unlinkSync(novoApp); } catch {}
    if (!SOBREPOR || !antigo || antigo.isDead()) vigiar(ligar(APP));
  } finally {
    trocando = false;
  }
}

async function atualizar() {
  if (trocando) return;
  try {
    const [app, pagina, login, sup] = await Promise.all(["app.js", "public/index.html", "public/login.html", "servidor.js"].map(buscar));
    let mudou = false, novoApp = null;
    // Só aceita arquivos completos: uma resposta cortada nunca derruba o site.
    for (const [texto, nome, ok] of [[pagina, "index.html", /<\/html>/], [login, "login.html", /\/entrar/]]) {
      if (ok.test(texto) && texto.includes("</html>") && texto !== ler(join(PASTA, nome))) {
        writeFileSync(join(PASTA, nome + ".novo"), texto); renameSync(join(PASTA, nome + ".novo"), join(PASTA, nome));
        mudou = true; log(`atualizado: ${nome}`);
      }
    }
    if (app !== ler(APP)) {
      novoApp = join(DIR, "app.novo.js");
      writeFileSync(novoApp, app);
      if (!valido(novoApp)) { log("app.js novo tem erro; ignorado."); unlinkSync(novoApp); novoApp = null; }
      else { mudou = true; log("atualizado: app.js"); }
    }
    if (mudou) await aplicar(novoApp);
    // O próprio supervisor só muda em casos raros; aí o container reinicia uma vez.
    if (sup !== ler(join(DIR, "servidor.js"))) {
      const teste = join(DIR, "servidor.teste.js");
      writeFileSync(teste, sup);
      if (!valido(teste)) { unlinkSync(teste); return; }
      renameSync(teste, join(DIR, "servidor.js"));
      log("supervisor novo; reiniciando o container para aplicar.");
      setTimeout(() => process.exit(0), 300);
    }
  } catch (e) {
    log(`não consegui verificar atualizações agora (${e.message}). Tento de novo depois.`);
  }
}

if (cluster.isPrimary) {
  process.on("unhandledRejection", (e) => log("erro não tratado:", e));
  process.on("uncaughtException", (e) => log("erro inesperado:", e));
  // Primeira vez com o supervisor (ou app apagado): baixa o app antes de ligar.
  if (!existsSync(APP)) {
    mkdirSync(PASTA, { recursive: true });
    for (let i = 1; !existsSync(APP); i++) {
      try {
        const baixado = join(DIR, "app.baixado.js");
        writeFileSync(baixado, await buscar("app.js"));
        if (!valido(baixado)) throw new Error("arquivo com erro");
        renameSync(baixado, APP);
      } catch (e) { log(`baixando o app (${e.message}); tentativa ${i}.`); await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * i))); }
    }
  }
  vigiar(ligar(APP));
  log(`no ar. Atualização ${process.env.ATUALIZACAO === "0" ? "desligada" : `a cada ${INTERVALO / 60000} min, sem queda`}${SOBREPOR ? "" : " (memória curta: troca rápida em vez de sobreposta)"}.`);
  if (process.env.ATUALIZACAO !== "0") setInterval(atualizar, INTERVALO);
  for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { for (const w of Object.values(cluster.workers)) w.kill(s); process.exit(0); });
}
