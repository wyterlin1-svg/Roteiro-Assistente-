// Armazenamento em um arquivo JSON: zero banco de dados, fácil de copiar e
// fazer backup. A escrita é atômica (grava num temporário e renomeia).
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const PASTA = process.env.DADOS || join(process.cwd(), 'data');
const ARQUIVO = join(PASTA, 'usuarios.json');

mkdirSync(PASTA, { recursive: true });
let dados = { usuarios: [] };
let versaoArquivo = 0;

// Relê o arquivo se outro processo (ex.: `npm run usuarios`) o alterou.
function sincronizar() {
  if (!existsSync(ARQUIVO)) return;
  const m = statSync(ARQUIVO).mtimeMs;
  if (m !== versaoArquivo) {
    dados = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
    versaoArquivo = m;
  }
}
sincronizar();

function salvar() {
  const tmp = ARQUIVO + '.tmp';
  writeFileSync(tmp, JSON.stringify(dados, null, 2), { mode: 0o600 });
  renameSync(tmp, ARQUIVO);
  versaoArquivo = statSync(ARQUIVO).mtimeMs;
}

export const mesAtual = () => new Date().toISOString().slice(0, 7);
const normalizar = (email) => String(email || '').trim().toLowerCase();

export const listar = () => (sincronizar(), dados.usuarios);
export const porId = (id) => listar().find((u) => u.id === id);
export const porEmail = (email) => listar().find((u) => u.email === normalizar(email));

export function criar({ email, nome = '', hash, papel = 'cliente', limite_mensal = 30 }) {
  email = normalizar(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  if (porEmail(email)) throw new Error('Já existe um usuário com esse e-mail.');
  const u = {
    id: randomBytes(8).toString('hex'), email, nome: String(nome).trim(), hash, papel,
    ativo: true, versao: 1, limite_mensal: papel === 'admin' ? null : limite_mensal,
    uso: {}, criado_em: new Date().toISOString(), ultimo_acesso: null,
  };
  dados.usuarios.push(u);
  salvar();
  return u;
}

export function atualizar(id, mudancas) {
  const u = porId(id);
  if (!u) throw new Error('Usuário não encontrado.');
  Object.assign(u, mudancas);
  salvar();
  return u;
}

export const usoDoMes = (u) => u.uso?.[mesAtual()] || 0;

/** Reserva 1 roteiro na cota do mês. Retorna false se a cota acabou. */
export function reservar(u) {
  if (u.limite_mensal != null && usoDoMes(u) >= u.limite_mensal) return false;
  u.uso[mesAtual()] = usoDoMes(u) + 1;
  salvar();
  return true;
}

export function devolver(quem) {
  const u = porId(quem.id); // a geração demora: relê caso o arquivo tenha mudado no meio
  if (!u) return;
  u.uso[mesAtual()] = Math.max(0, usoDoMes(u) - 1);
  salvar();
}

/** Visão segura do usuário (sem hash) para mandar ao navegador. */
export const publico = (u) => ({
  id: u.id, email: u.email, nome: u.nome, papel: u.papel, ativo: u.ativo,
  limite_mensal: u.limite_mensal, uso_mes: usoDoMes(u), criado_em: u.criado_em, ultimo_acesso: u.ultimo_acesso,
});
