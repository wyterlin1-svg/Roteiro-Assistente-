import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avaliar, acharCliches, estimarSegundos } from '../src/motor/viralometro.js';
import { colidir } from '../src/motor/colisao.js';
import { pedido } from '../src/motor/prompt.js';

const exemplo = JSON.parse(readFileSync(new URL('../src/exemplo.json', import.meta.url)));

test('exemplo passa no Viralômetro', () => {
  const v = avaliar(exemplo, 40);
  assert.ok(v.total >= 85, `nota ${v.total}: ${v.alertas.join(' | ')}`);
  assert.ok(v.segundos_estimados <= 40);
});

test('roteiro longo demais perde pontos de duração', () => {
  const longo = structuredClone(exemplo);
  longo.roteiro[2].fala = 'palavra '.repeat(80);
  const v = avaliar(longo, 30);
  assert.ok(v.notas.duracao < 25);
  assert.ok(v.alertas.some((a) => a.includes('passa do limite')));
});

test('clichês de IA são detectados', () => {
  assert.deepEqual(acharCliches('Fala galera! Você sabia que existe um segredo?'), ['você sabia que', 'fala galera']);
  const generico = structuredClone(exemplo);
  generico.roteiro[0].fala = 'Olá pessoal, neste vídeo vamos falar sobre café';
  const v = avaliar(generico, 40);
  assert.ok(v.notas.originalidade < 10);
  assert.ok(v.notas.gancho < 25);
});

test('CTA de envio vale mais que comentar', () => {
  const c = structuredClone(exemplo);
  c.cta.tipo = 'comentar';
  assert.ok(avaliar(c).notas.cta < avaliar(exemplo).notas.cta);
});

test('estimativa de fala ~2,6 palavras/s', () => {
  assert.equal(estimarSegundos('um dois três quatro cinco seis sete oito nove dez onze doze treze'), 5);
});

test('colisão é determinística pela semente', () => {
  assert.deepEqual(colidir('ab12c'), colidir('AB12C'));
  assert.notDeepEqual(colidir('AAAAA'), colidir('ZZZZZ'));
  assert.match(colidir().semente, /^[A-Z2-9]{5}$/);
});

test('pedido sem tema ativa o modo "sem ideia"', () => {
  const p = pedido({ nicho: 'confeitaria', tema: '', duracao: 30, colisao: colidir('K7P2Q') });
  assert.match(p, /sem ideia/);
  assert.match(p, /no máximo 78 palavras/);
  assert.match(p, /COLISÃO #K7P2Q/);
});
