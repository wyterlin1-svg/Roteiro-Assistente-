// Viralômetro: auditoria local (custo zero) de cada roteiro contra os sinais
// que o Instagram prioriza em Reels: retenção nos 3 primeiros segundos, tempo
// assistido/conclusão, replays, envios por DM, salvamentos e comentários.
// Não "prevê" viralização — mede se o roteiro respeita o que a aumenta.

export const PALAVRAS_POR_SEGUNDO = 2.6; // fala natural em PT-BR para Reels
export const DURACAO_MAXIMA = 40;

export const CLICHES = [
  'você sabia que',
  'neste vídeo',
  'nesse vídeo',
  'fala galera',
  'fala, galera',
  'olá pessoal',
  'oi gente',
  'segue para mais',
  'siga para mais',
  'não esquece de curtir',
  'deixa seu like',
  'descubra',
  'mergulhar',
  'mergulhe',
  'desvendar',
  'jornada',
  'incrível',
  'no mundo de hoje',
  'nos dias de hoje',
  'vamos falar sobre',
  'hoje eu vou te mostrar',
  'fique até o final',
  'assista até o final',
  'transforme sua vida',
  'segredo revelado',
];

// Marcadores de tensão no gancho: número, pergunta, exclamação, contraste ou proibição.
const TENSAO = /\d|\?|!|nunca|ningu[eé]m|\bpar[ea]\b|\berr[oa]|errad|mentir|proibid|verdade|cuidado|evite|\bmas\b|(^|\s)só(?=[\s,.!?]|$)/i;

export const contarPalavras = (t = '') => (t.trim().match(/\S+/g) || []).length;

export function estimarSegundos(texto) {
  return contarPalavras(texto) / PALAVRAS_POR_SEGUNDO;
}

export function acharCliches(texto = '') {
  const t = texto.toLowerCase();
  return CLICHES.filter((c) => t.includes(c));
}

export function avaliar(roteiro, duracaoAlvo = DURACAO_MAXIMA) {
  const alertas = [];
  const notas = {};
  const cenas = roteiro.roteiro || [];
  const falaTotal = cenas.map((c) => c.fala).join(' ');
  const tudo = [falaTotal, roteiro.legenda, ...(roteiro.ganchos || []).map((g) => g.fala)].join(' ');

  // 1. Gancho (retenção 3s) — 25 pts
  const gancho = cenas[0]?.fala || '';
  const pGancho = contarPalavras(gancho);
  let g = 0;
  if (pGancho > 0 && pGancho <= 12) g += 12;
  else alertas.push(`Gancho com ${pGancho} palavras: corte para no máximo 12 (cabe em ~3s).`);
  if (TENSAO.test(gancho)) g += 7;
  else alertas.push('Gancho sem tensão (número, contraste, pergunta ou proibição).');
  if (cenas[0]?.texto_tela) g += 6;
  else alertas.push('Gancho sem texto na tela — muita gente assiste sem som.');
  notas.gancho = g;

  // 2. Duração / conclusão — 25 pts
  const segundos = estimarSegundos(falaTotal);
  const limite = Math.min(duracaoAlvo, DURACAO_MAXIMA);
  let d = 0;
  if (segundos <= limite) d = 25;
  else {
    d = Math.max(0, 25 - Math.ceil((segundos - limite) * 3));
    alertas.push(`Fala estimada em ${segundos.toFixed(1)}s — passa do limite de ${limite}s.`);
  }
  notas.duracao = d;

  // 3. Ritmo (interrupções de padrão) — 15 pts
  const blocos = cenas.map((c) => Math.max(0, (c.fim_s ?? 0) - (c.inicio_s ?? 0)));
  const maior = blocos.length ? Math.max(...blocos) : 0;
  let r = 15;
  if (maior > 6) {
    r = 8;
    alertas.push(`Cena de ${maior}s sem quebra visual: insira corte, zoom ou texto a cada 3–5s.`);
  }
  if (cenas.length < 4) r -= 5;
  const apertadas = cenas.filter((c, i) => estimarSegundos(c.fala) > blocos[i] + 1);
  if (apertadas.length) {
    r -= 3;
    alertas.push(`${apertadas.length} cena(s) com mais fala do que tempo: ajuste os cortes.`);
  }
  notas.ritmo = Math.max(0, r);

  // 4. Replay (loop) — 10 pts
  notas.loop = roteiro.loop && roteiro.loop.trim().length > 10 ? 10 : 0;
  if (!notas.loop) alertas.push('Sem loop: o final não puxa o replay.');

  // 5. CTA orientado ao sinal mais forte — 15 pts
  const pesoCta = { envio: 15, salvar: 12, comentar: 10 };
  notas.cta = pesoCta[roteiro.cta?.tipo] ?? 0;
  if (roteiro.cta?.tipo !== 'envio') alertas.push('CTA de envio ("manda pra…") é o que mais alcança não seguidores.');

  // 6. Originalidade (antifórmula) — 10 pts
  const cliches = acharCliches(tudo);
  notas.originalidade = Math.max(0, 10 - cliches.length * 5);
  if (cliches.length) alertas.push(`Clichês de IA detectados: ${cliches.join(', ')}.`);

  const total = Object.values(notas).reduce((a, b) => a + b, 0);
  return {
    total,
    nivel: total >= 85 ? 'Pronto para postar' : total >= 65 ? 'Bom, ajuste os alertas' : 'Reescreva antes de gravar',
    segundos_estimados: Number(segundos.toFixed(1)),
    palavras: contarPalavras(falaTotal),
    notas,
    alertas,
  };
}
