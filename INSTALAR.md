# Instalar no seu servidor

Você precisa de um servidor Linux (VPS) com acesso SSH, de um domínio apontando para ele (ex.: `roteiros.seusite.com`) e de uma chave da API da Anthropic (https://console.anthropic.com).

## Opção A: Docker (recomendado)

```bash
git clone https://github.com/wyterlin1-svg/Roteiro-Assistente-.git roteirista
cd roteirista
cp .env.example .env
nano .env                      # cole sua ANTHROPIC_API_KEY e coloque COOKIE_SEGURO=1
docker compose up -d --build

# crie o SEU acesso de administrador
docker compose exec roteirista node usuarios.js admin voce@email.com SuaSenhaForte
```

## Opção B: Node direto, sem Docker

```bash
# Node 22 ou superior
git clone https://github.com/wyterlin1-svg/Roteiro-Assistente-.git roteirista
cd roteirista && npm ci --omit=dev
cp .env.example .env && nano .env
npm run usuarios -- admin voce@email.com SuaSenhaForte
npm i -g pm2 && pm2 start "npm start" --name roteirista && pm2 save && pm2 startup
```

## HTTPS (obrigatório para login seguro)

O jeito mais simples é o Caddy, que emite e renova o certificado sozinho. Em `/etc/caddy/Caddyfile`:

```
roteiros.seusite.com {
    reverse_proxy 127.0.0.1:3000
}
```

Depois rode `sudo systemctl reload caddy`. Se você já usa nginx, faça `proxy_pass http://127.0.0.1:3000;` e envie o cabeçalho `X-Forwarded-Proto` e `X-Forwarded-For`.

## Dia a dia

| O quê | Onde |
|---|---|
| Criar cliente, bloquear, nova senha, mudar limite | `https://roteiros.seusite.com/admin` |
| O cliente entra | `https://roteiros.seusite.com/login` |
| Pelo terminal | `npm run usuarios -- criar ana@x.com --limite 30 --nome "Ana"` · `listar` · `senha <email>` · `bloquear <email>` · `desbloquear <email>` |

No Docker, troque `npm run usuarios --` por `docker compose exec roteirista node usuarios.js`.

- **Limite mensal:** cada cliente tem uma cota de roteiros por mês, que zera sozinha no mês seguinte. Gerações que falham não são descontadas. Use a cota para controlar seu custo com a API e montar planos (ex.: 30, 100 ou ilimitado).
- **Bloquear** ou **gerar nova senha** derruba na hora as sessões abertas daquele cliente.
- **Backup:** tudo fica na pasta `data/` (`usuarios.json` e `segredo.txt`). Basta copiar essa pasta.
- **Atualizar:** `git pull && docker compose up -d --build` (ou `git pull && pm2 restart roteirista`).

## Segurança incluída

- Senhas com scrypt (nunca guardadas em texto).
- Sessão em cookie `HttpOnly` e `SameSite`, assinado e com validade de 7 dias.
- 5 senhas erradas seguidas bloqueiam novas tentativas por 15 minutos.
- A API só aceita JSON, o que bloqueia formulários de outros sites (CSRF).
- O painel `/admin` e a API de administração só respondem a administradores.
- A chave da Anthropic fica só no servidor: o cliente nunca a vê.
