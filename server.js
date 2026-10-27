import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gerarRoteiro, MODELO } from './src/motor/gerar.js';
import { avaliar } from './src/motor/viralometro.js';
import { colidir } from './src/motor/colisao.js';

const PORTA = Number(process.env.PORT) || 3000;
const pagina = await readFile(new URL('./public/index.html', import.meta.url));

function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(pagina);
  }
  // Rolar o dado da colisão criativa é local e grátis: o usuário escolhe antes de gastar.
  if (req.method === 'GET' && req.url.startsWith('/api/dado')) {
    const s = new URL(req.url, 'http://x').searchParams.get('s');
    return json(res, 200, colidir(s || undefined));
  }
  // Exemplo pronto: deixa testar a interface e o teleprompter sem gastar nada.
  if (req.method === 'GET' && req.url === '/api/exemplo') {
    const roteiro = JSON.parse(await readFile(new URL('./src/exemplo.json', import.meta.url)));
    return json(res, 200, {
      roteiro, viralometro: avaliar(roteiro, 40), colisao: colidir('K7P2Q'), modelo: 'exemplo', custo_usd: 0, reescrito: false,
    });
  }
  if (req.method === 'POST' && req.url === '/api/roteiro') {
    let corpo = '';
    for await (const parte of req) {
      corpo += parte;
      if (corpo.length > 10_000) return json(res, 413, { erro: 'Pedido grande demais.' });
    }
    try {
      return json(res, 200, await gerarRoteiro(JSON.parse(corpo || '{}')));
    } catch (e) {
      console.error(e);
      const semChave = e.status === 401 || /authentication/i.test(e.message);
      return json(res, e.status || 400, {
        erro: semChave ? 'Chave da API ausente ou inválida: configure ANTHROPIC_API_KEY no arquivo .env.' : e.message,
      });
    }
  }
  json(res, 404, { erro: 'Não encontrado.' });
}).listen(PORTA, () => console.log(`Roteirista 40s em http://localhost:${PORTA} (modelo: ${MODELO})`));
