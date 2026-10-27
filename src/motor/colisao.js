// Colisão Criativa: em vez de pedir "uma ideia" (o que faz toda IA cair no
// mesmo lugar-comum), sorteamos peças que normalmente não andam juntas e
// obrigamos o modelo a resolver a tensão entre elas. Custo zero: é local.

export const EMOCOES = [
  'raiva justa (injustiça que todo mundo já sentiu)',
  'alívio ("então não sou só eu")',
  'nostalgia afiada',
  'orgulho de grupo (identidade)',
  'medo de estar perdendo algo',
  'vergonha alheia divertida',
  'surpresa genuína (quebra de expectativa)',
  'esperança concreta',
  'indignação com um mito',
  'ternura inesperada',
];

export const ANGULOS = [
  'confissão: admitir um erro que o público também comete',
  'contraintuitivo: defender o oposto do conselho popular',
  'erro caro: mostrar quanto custou fazer do jeito "certo"',
  'teste ao vivo: provar algo na frente da câmera',
  'o que ninguém conta: bastidor que o mercado esconde',
  'ranking polêmico: ordenar algo que gera discordância',
  'mito destruído em 3 provas',
  'carta para o eu do passado',
  'detetive: investigar um detalhe que todo mundo ignora',
  'cronômetro: resolver algo antes do vídeo acabar',
  'tradução: explicar algo complexo como se fosse fofoca',
  'tribunal: acusar um hábito comum e julgar',
];

export const FORMATOS = [
  'fala direta, olho na câmera, cortes secos',
  'POV em primeira pessoa',
  'voz em off + imagens do cotidiano (B-roll)',
  'encenação com 2 personagens (a mesma pessoa)',
  'green screen sobre print/notícia',
  'lista relâmpago com contador na tela',
  'plano-sequência sem cortes',
  'tela dividida: expectativa x realidade',
];

export const RESTRICOES = [
  'começar pelo final da história',
  'usar um objeto do dia a dia como metáfora central',
  'nunca dizer o nome do produto/tema explicitamente',
  'contar tudo usando exatamente 3 números',
  'a primeira frase precisa ser uma ordem curta',
  'o roteiro inteiro em diálogo',
  'terminar com a mesma frase que abriu (loop perfeito)',
  'incluir uma pausa de silêncio proposital',
  'revelar a resposta só no último segundo',
  'falar com uma pessoa específica ("você que…")',
];

// PRNG determinístico (mulberry32): a mesma semente sempre gera a mesma colisão,
// então o usuário pode compartilhar/repetir um "dado" que funcionou.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function novaSemente() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return s;
}

function hash(texto) {
  let h = 2166136261;
  for (const c of texto) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function colidir(semente = novaSemente()) {
  const codigo = String(semente).toUpperCase().trim();
  const r = prng(hash(codigo));
  const pick = (lista) => lista[Math.floor(r() * lista.length)];
  return {
    semente: codigo,
    emocao: pick(EMOCOES),
    angulo: pick(ANGULOS),
    formato: pick(FORMATOS),
    restricao: pick(RESTRICOES),
  };
}
