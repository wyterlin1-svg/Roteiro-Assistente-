import Anthropic from '@anthropic-ai/sdk';
import { SISTEMA, ESQUEMA, pedido } from './prompt.js';
import { colidir } from './colisao.js';
import { avaliar, DURACAO_MAXIMA } from './viralometro.js';

export const MODELO = process.env.MODELO || 'claude-opus-5-5';
const ESFORCO = process.env.ESFORCO || 'low';

// US$ por milhão de tokens (entrada, saída) — só para mostrar o custo de cada roteiro.
const PRECOS = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

const cliente = new Anthropic();

function custo(usage) {
  const [pin, pout] = PRECOS[MODELO] || [0, 0];
  const entrada = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25
    + (usage.cache_read_input_tokens || 0) * 0.1;
  return Number(((entrada * pin + (usage.output_tokens || 0) * pout) / 1e6).toFixed(5));
}

async function chamar(texto) {
  const r = await cliente.beta.messages.create({
    model: MODELO,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: ESFORCO, format: { type: 'json_schema', schema: ESQUEMA } },
    system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: texto }],
  });
  if (r.stop_reason === 'refusal') throw new Error('O modelo recusou este pedido. Reformule o tema.');
  if (r.stop_reason === 'max_tokens') throw new Error('Resposta cortada. Tente de novo.');
  const bloco = r.content.find((b) => b.type === 'text');
  return { roteiro: JSON.parse(bloco.text), usage: r.usage };
}

/**
 * Gera um roteiro. Se o Viralômetro reprovar (nota < 65), faz UMA reescrita
 * automática apontando os problemas — no máximo 2 chamadas por roteiro.
 */
export async function gerarRoteiro({ nicho, tema = '', publico = '', tom = '', duracao = 30, semente } = {}) {
  if (!nicho?.trim()) throw new Error('Informe o nicho.');
  const dur = Math.max(10, Math.min(Number(duracao) || 30, DURACAO_MAXIMA));
  const colisao = colidir(semente || undefined);
  const base = { nicho, tema, publico, tom, duracao: dur, colisao };

  let { roteiro, usage } = await chamar(pedido(base));
  let nota = avaliar(roteiro, dur);
  let gasto = custo(usage);
  let reescrito = false;

  if (nota.total < 65 && nota.alertas.length) {
    const segunda = await chamar(pedido({ ...base, ajuste: nota.alertas.map((a) => `- ${a}`).join('\n') }));
    const nota2 = avaliar(segunda.roteiro, dur);
    gasto += custo(segunda.usage);
    if (nota2.total >= nota.total) {
      roteiro = segunda.roteiro;
      nota = nota2;
      reescrito = true;
    }
  }

  return { roteiro, viralometro: nota, colisao, modelo: MODELO, custo_usd: Number(gasto.toFixed(5)), reescrito };
}
