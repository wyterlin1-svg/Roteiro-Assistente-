import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DADOS = mkdtempSync(join(tmpdir(), 'r40s-'));
const loja = await import('../src/contas/loja.js');
const auth = await import('../src/contas/auth.js');

test('senha: hash confere e senha curta é recusada', async () => {
  const h = await auth.gerarHash('umaSenhaBoa');
  assert.ok(await auth.conferirSenha('umaSenhaBoa', h));
  assert.ok(!(await auth.conferirSenha('outraSenha', h)));
  await assert.rejects(auth.gerarHash('curta'));
});

test('cota mensal: reserva até o limite e devolve em caso de falha', async () => {
  const u = loja.criar({ email: 'cota@teste.com', hash: 'x', limite_mensal: 2 });
  assert.ok(loja.reservar(u));
  assert.ok(loja.reservar(u));
  assert.equal(loja.reservar(u), false);
  loja.devolver(u);
  assert.equal(loja.usoDoMes(loja.porId(u.id)), 1);
});

test('sessão: token válido, adulterado e invalidado por troca de versão', () => {
  const u = loja.criar({ email: 'sessao@teste.com', hash: 'x' });
  const t = auth.criarToken(u);
  assert.equal(auth.lerToken(t)?.id, u.id);
  assert.equal(auth.lerToken(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), null);
  loja.atualizar(u.id, { versao: u.versao + 1 }); // ex.: senha trocada
  assert.equal(auth.lerToken(t), null);
});

test('e-mail duplicado ou inválido é recusado', () => {
  assert.throws(() => loja.criar({ email: 'SESSAO@teste.com', hash: 'x' }), /Já existe/);
  assert.throws(() => loja.criar({ email: 'sem-arroba', hash: 'x' }), /inválido/);
});
