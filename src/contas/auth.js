// Senhas com scrypt (nativo do Node) e sessão em cookie assinado com HMAC.
// Sem dependências. Trocar a senha ou bloquear o usuário derruba as sessões
// abertas dele (o cookie carrega a "versão" do usuário).
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PASTA, porId } from './loja.js';

const scryptAsync = promisify(scrypt);
const DURACAO_SESSAO = 7 * 24 * 3600 * 1000; // 7 dias
export const COOKIE = 'r40s';

function carregarSegredo() {
  if (process.env.SEGREDO_SESSAO) return process.env.SEGREDO_SESSAO;
  const arq = join(PASTA, 'segredo.txt');
  if (!existsSync(arq)) writeFileSync(arq, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(arq, 'utf8').trim();
}
const SEGREDO = carregarSegredo();

export async function gerarHash(senha) {
  if (String(senha).length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const sal = randomBytes(16);
  const chave = await scryptAsync(String(senha), sal, 64);
  return `scrypt$${sal.toString('hex')}$${chave.toString('hex')}`;
}

export async function conferirSenha(senha, hash) {
  const [, salHex, chaveHex] = String(hash).split('$');
  if (!salHex || !chaveHex) return false;
  const chave = await scryptAsync(String(senha), Buffer.from(salHex, 'hex'), 64);
  return timingSafeEqual(chave, Buffer.from(chaveHex, 'hex'));
}

const assinar = (texto) => createHmac('sha256', SEGREDO).update(texto).digest('base64url');

export function criarToken(u) {
  const corpo = `${u.id}.${u.versao}.${Date.now() + DURACAO_SESSAO}`;
  return `${corpo}.${assinar(corpo)}`;
}

/** Devolve o usuário dono do token, ou null se inválido/expirado/bloqueado. */
export function lerToken(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 4) return null;
  const [id, versao, expira, assinatura] = partes;
  const esperado = Buffer.from(assinar(`${id}.${versao}.${expira}`));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  if (Number(expira) < Date.now()) return null;
  const u = porId(id);
  if (!u || !u.ativo || String(u.versao) !== versao) return null;
  return u;
}

export function lerCookie(req, nome = COOKIE) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function cookieSessao(token, req) {
  const https = process.env.COOKIE_SEGURO === '1' || req.headers['x-forwarded-proto'] === 'https';
  const base = `${COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`;
  return token ? `${base}; Max-Age=${DURACAO_SESSAO / 1000}` : `${base}; Max-Age=0`;
}

// Proteção contra força bruta: 5 erros seguidos bloqueiam por 15 minutos.
const tentativas = new Map();
const JANELA = 15 * 60 * 1000;

export function bloqueadoPorTentativas(chave) {
  const t = tentativas.get(chave);
  return t && t.n >= 5 && Date.now() - t.desde < JANELA;
}
export function registrarErro(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.desde > JANELA) tentativas.set(chave, { n: 1, desde: Date.now() });
  else t.n++;
}
export const limparErros = (chave) => tentativas.delete(chave);
