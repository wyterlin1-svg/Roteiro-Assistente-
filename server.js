import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { gerarRoteiro, MODELO } from './src/motor/gerar.js';
import { avaliar } from './src/motor/viralometro.js';
import { colidir } from './src/motor/colisao.js';
import * as loja from './src/contas/loja.js';
import * as auth from './src/contas/auth.js';

const PORTA = Number(process.env.PORT) || 3000;
const pagina = async (nome) => readFile(new URL(`./public/${nome}`, import.meta.url));
const [APP, LOGIN, ADMIN] = await Promise.all(['index.html', 'login.html', 'admin.html'].map(pagina));

const SEGURANCA = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
};

function json(res, status, corpo, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEGURANCA, ...extra });
  res.end(JSON.stringify(corpo));
}
function html(res, conteudo) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEGURANCA });
  res.end(conteudo);
}
function redirecionar(res, para) {
  res.writeHead(302, { location: para });
  res.end();
}

async function lerCorpo(req) {
  // Exigir JSON impede formulários de outros sites de postarem aqui (CSRF).
  if (!String(req.headers['content-type']).startsWith('application/json')) throw Object.assign(new Error('Envie JSON.'), { status: 415 });
  let corpo = '';
  for await (const parte of req) {
    corpo += parte;
    if (corpo.length > 10_000) throw Object.assign(new Error('Pedido grande demais.'), { status: 413 });
  }
  return JSON.parse(corpo || '{}');
}

const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();

async function rotear(req, res) {
  const url = new URL(req.url, 'http://x');
  const rota = `${req.method} ${url.pathname}`;
  const eu = auth.lerToken(auth.lerCookie(req));

  // ---- Páginas ----
  if (rota === 'GET /login') return eu ? redirecionar(res, '/') : html(res, LOGIN);
  if (rota === 'GET /' || rota === 'GET /index.html') return eu ? html(res, APP) : redirecionar(res, '/login');
  if (rota === 'GET /admin') return eu?.papel === 'admin' ? html(res, ADMIN) : redirecionar(res, '/');

  // ---- Sessão ----
  if (rota === 'POST /api/login') {
    const { email, senha } = await lerCorpo(req);
    const chave = `${ip(req)}|${String(email).toLowerCase()}`;
    if (auth.bloqueadoPorTentativas(chave)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde 15 minutos.' });
    const u = loja.porEmail(email);
    const ok = u && u.ativo && (await auth.conferirSenha(senha, u.hash));
    if (!ok) {
      auth.registrarErro(chave);
      return json(res, 401, { erro: u && !u.ativo ? 'Acesso bloqueado. Fale com o suporte.' : 'E-mail ou senha incorretos.' });
    }
    auth.limparErros(chave);
    loja.atualizar(u.id, { ultimo_acesso: new Date().toISOString() });
    return json(res, 200, loja.publico(u), { 'set-cookie': auth.cookieSessao(auth.criarToken(u), req) });
  }
  if (rota === 'POST /api/logout') return json(res, 200, { ok: true }, { 'set-cookie': auth.cookieSessao(null, req) });

  // Daqui para baixo, só com login.
  if (!eu) return json(res, 401, { erro: 'Sessão expirada. Entre novamente.' });

  if (rota === 'GET /api/eu') return json(res, 200, { ...loja.publico(eu), modelo: MODELO });

  if (rota === 'POST /api/senha') {
    const { atual, nova } = await lerCorpo(req);
    if (!(await auth.conferirSenha(atual, eu.hash))) return json(res, 400, { erro: 'Senha atual incorreta.' });
    const u = loja.atualizar(eu.id, { hash: await auth.gerarHash(nova), versao: eu.versao + 1 });
    return json(res, 200, { ok: true }, { 'set-cookie': auth.cookieSessao(auth.criarToken(u), req) });
  }

  // ---- Roteirista ----
  if (rota === 'GET /api/dado') return json(res, 200, colidir(url.searchParams.get('s') || undefined));
  if (rota === 'GET /api/exemplo') {
    const roteiro = JSON.parse(await readFile(new URL('./src/exemplo.json', import.meta.url)));
    return json(res, 200, { roteiro, viralometro: avaliar(roteiro, 40), colisao: colidir('K7P2Q'), modelo: 'exemplo', custo_usd: 0, reescrito: false });
  }
  if (rota === 'POST /api/roteiro') {
    const pedido = await lerCorpo(req);
    if (!loja.reservar(eu)) return json(res, 402, { erro: `Você usou os ${eu.limite_mensal} roteiros do seu plano neste mês.` });
    try {
      const r = await gerarRoteiro(pedido);
      return json(res, 200, { ...r, uso_mes: loja.usoDoMes(eu), limite_mensal: eu.limite_mensal });
    } catch (e) {
      loja.devolver(eu); // falhou: não conta na cota
      throw e;
    }
  }

  // ---- Administração ----
  if (url.pathname.startsWith('/api/admin/') && eu.papel !== 'admin') return json(res, 403, { erro: 'Só administradores.' });

  if (rota === 'GET /api/admin/usuarios') return json(res, 200, loja.listar().map(loja.publico));

  if (rota === 'POST /api/admin/usuarios') {
    const { email, nome, senha, limite_mensal, papel } = await lerCorpo(req);
    const senhaFinal = senha || randomBytes(6).toString('base64url');
    const u = loja.criar({
      email, nome, papel: papel === 'admin' ? 'admin' : 'cliente',
      hash: await auth.gerarHash(senhaFinal),
      limite_mensal: limite_mensal === '' || limite_mensal == null ? null : Math.max(0, Number(limite_mensal)),
    });
    return json(res, 201, { ...loja.publico(u), senha: senhaFinal });
  }

  const m = url.pathname.match(/^\/api\/admin\/usuarios\/([a-f0-9]+)$/);
  if (m && req.method === 'PATCH') {
    const alvo = loja.porId(m[1]);
    if (!alvo) return json(res, 404, { erro: 'Usuário não encontrado.' });
    const corpo = await lerCorpo(req);
    const mudancas = {};
    if ('ativo' in corpo) {
      if (alvo.id === eu.id) return json(res, 400, { erro: 'Você não pode bloquear a si mesmo.' });
      mudancas.ativo = Boolean(corpo.ativo);
      mudancas.versao = alvo.versao + 1; // derruba sessões abertas
    }
    if ('limite_mensal' in corpo) {
      mudancas.limite_mensal = corpo.limite_mensal === '' || corpo.limite_mensal == null ? null : Math.max(0, Number(corpo.limite_mensal));
    }
    if ('zerar_uso' in corpo) mudancas.uso = { ...alvo.uso, [loja.mesAtual()]: 0 };
    let senha;
    if (corpo.nova_senha !== undefined) {
      senha = corpo.nova_senha || randomBytes(6).toString('base64url');
      mudancas.hash = await auth.gerarHash(senha);
      mudancas.versao = alvo.versao + 1;
    }
    const u = loja.atualizar(alvo.id, mudancas);
    return json(res, 200, { ...loja.publico(u), ...(senha && { senha }) });
  }

  return json(res, 404, { erro: 'Não encontrado.' });
}

createServer(async (req, res) => {
  try {
    await rotear(req, res);
  } catch (e) {
    if (!(e.constructor === Error && !e.status) && !(e.status < 500)) console.error(e);
    const semChave = /authentication/i.test(e.message) || e.status === 401;
    // Erros de validação nossos são `Error` simples (400); bugs (TypeError etc.) viram 500 sem detalhes.
    const status = e instanceof SyntaxError ? 400 : e.status ? (e.status < 500 ? e.status : 503)
      : e.constructor === Error ? 400 : 500;
    json(res, status, {
      erro: semChave ? 'O servidor está sem chave da API configurada. Avise o administrador.'
        : status === 500 ? 'Erro interno. Tente de novo em instantes.' : e.message,
    });
  }
}).listen(PORTA, () => {
  console.log(`Roteirista 40s em http://localhost:${PORTA} (modelo: ${MODELO})`);
  if (!loja.listar().some((u) => u.papel === 'admin')) {
    console.log('⚠ Nenhum administrador ainda. Crie um com: npm run usuarios -- admin seu@email.com SUA_SENHA');
  }
});
