#!/usr/bin/env node
// Uso: node cli.js "nicho" ["tema"] [--duracao 30] [--semente K7P2Q] [--json]
import { parseArgs } from 'node:util';
import { gerarRoteiro } from './src/motor/gerar.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    duracao: { type: 'string', default: '30' },
    semente: { type: 'string' },
    publico: { type: 'string', default: '' },
    tom: { type: 'string', default: '' },
    json: { type: 'boolean', default: false },
  },
});

const [nicho, tema = ''] = positionals;
if (!nicho) {
  console.error('Uso: node cli.js "nicho" ["tema"] [--duracao 30] [--semente K7P2Q] [--json]');
  process.exit(1);
}

const r = await gerarRoteiro({ nicho, tema, ...values });
if (values.json) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

const { roteiro: s, viralometro: v, colisao: c } = r;
console.log(`\n🎬 ${s.titulo_interno}   [dado #${c.semente}]`);
console.log(`Emoção: ${s.emocao_dominante}  |  Envio: ${s.gatilho_de_envio}`);
console.log(`\nGANCHOS PARA TESTAR`);
s.ganchos.forEach((g, i) => console.log(` ${i + 1}. [${g.tipo}] "${g.fala}"  — tela: ${g.texto_tela}`));
console.log(`\nROTEIRO`);
for (const cena of s.roteiro) {
  console.log(`\n ${cena.inicio_s}s–${cena.fim_s}s  (${cena.funcao})`);
  console.log(`   🗣  ${cena.fala}`);
  if (cena.texto_tela) console.log(`   🔤 ${cena.texto_tela}`);
  console.log(`   🎥 ${cena.visual}`);
}
console.log(`\nLoop: ${s.loop}`);
console.log(`CTA (${s.cta.tipo}): ${s.cta.fala}`);
console.log(`Capa: ${s.texto_capa}   |   Áudio: ${s.audio_sugerido}`);
console.log(`\nLegenda:\n${s.legenda}`);
console.log(`\n📈 Viralômetro: ${v.total}/100 — ${v.nivel}  (~${v.segundos_estimados}s, ${v.palavras} palavras)`);
v.alertas.forEach((a) => console.log(`   ⚠ ${a}`));
console.log(`\n💰 ${r.modelo} · US$ ${r.custo_usd}${r.reescrito ? ' · reescrito 1x automaticamente' : ''}\n`);
