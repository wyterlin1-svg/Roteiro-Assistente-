#!/usr/bin/env node
// Gerencia acessos pelo terminal do servidor.
//   npm run usuarios -- admin <email> <senha>                 cria administrador
//   npm run usuarios -- criar <email> [senha] [--limite 30] [--nome "Ana"]
//   npm run usuarios -- listar
//   npm run usuarios -- senha <email> [nova]                  redefine (gera uma se omitida)
//   npm run usuarios -- bloquear <email> | desbloquear <email>
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import * as loja from './src/contas/loja.js';
import { gerarHash } from './src/contas/auth.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { limite: { type: 'string', default: '30' }, nome: { type: 'string', default: '' } },
});
const [cmd, email, senhaArg] = positionals;
const senha = senhaArg || randomBytes(6).toString('base64url');
const achar = () => loja.porEmail(email) ?? sair(`Usuário ${email} não encontrado.`);
function sair(msg) { console.error(msg); process.exit(1); }

try {
  switch (cmd) {
    case 'admin':
      if (!senhaArg) sair('Informe a senha: npm run usuarios -- admin <email> <senha>');
      loja.criar({ email, nome: values.nome, papel: 'admin', hash: await gerarHash(senha) });
      console.log(`✔ Administrador ${email} criado. Entre em /login e gerencie clientes em /admin.`);
      break;
    case 'criar': {
      const limite = values.limite === 'ilimitado' ? null : Number(values.limite);
      loja.criar({ email, nome: values.nome, hash: await gerarHash(senha), limite_mensal: limite });
      console.log(`✔ Cliente ${email} criado.\n  Senha: ${senha}\n  Limite: ${limite ?? 'ilimitado'} roteiros/mês`);
      break;
    }
    case 'listar':
      console.table(loja.listar().map((u) => ({
        email: u.email, nome: u.nome, papel: u.papel, ativo: u.ativo,
        uso_mes: loja.usoDoMes(u), limite: u.limite_mensal ?? '∞',
      })));
      break;
    case 'senha': {
      const u = achar();
      loja.atualizar(u.id, { hash: await gerarHash(senha), versao: u.versao + 1 });
      console.log(`✔ Nova senha de ${email}: ${senha}`);
      break;
    }
    case 'bloquear':
    case 'desbloquear': {
      const u = achar();
      loja.atualizar(u.id, { ativo: cmd === 'desbloquear', versao: u.versao + 1 });
      console.log(`✔ ${email} ${cmd === 'bloquear' ? 'bloqueado' : 'liberado'}.`);
      break;
    }
    default:
      sair('Comandos: admin | criar | listar | senha | bloquear | desbloquear');
  }
} catch (e) {
  sair(`✖ ${e.message}`);
}
