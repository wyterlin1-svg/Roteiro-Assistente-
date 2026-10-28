# Roteirista 40s

Agente de roteiros de Reels de até 40 segundos, guiado pelo algoritmo do Instagram: gancho nos 3 primeiros segundos, emoção, cortes a cada 3 a 5 segundos, final que emenda no começo e um motivo para mandarem o vídeo para alguém.

- Escreve **todas as falas**, prontas para o teleprompter, e a **direção de câmera** de cada cena.
- Falas fora da caixa: cada roteiro explica o assunto com um objeto do dia a dia que não tem nada a ver com o nicho.
- Funciona para **qualquer pessoa**: sem cadastro, sem chave de API e sem custo por roteiro. Tudo roda no navegador de quem usa.
- **🎲 Roteiro viral aleatório:** sorteia tema, estilo, objeto, formato e duração, puxando para o que já entregou mais com o seu público (80%) e testando o novo (20%).
- **📊 Aprende com os seus Reels:** você anota 6 números do Insights e o Roteirista calcula um Índice de Entrega e descobre o que o seu público premia.
- **🔬 Raio-X:** cole o texto de qualquer Reel e veja como ele se sai nos sinais do algoritmo.
- Servidor de um arquivo só (`servidor.js`), sem dependências, com tela de login.

## Subir no seu servidor (Docker)

Precisa de Docker com Compose no servidor.

```bash
git clone https://github.com/wyterlin1-svg/Roteiro-Assistente-.git roteirista
cd roteirista
docker compose up -d --build
```

Pronto: abra `http://IP-DO-SERVIDOR:8080` e entre com o acesso definido em `USUARIOS` no `docker-compose.yml`.

Sem Compose:

```bash
docker build -t roteirista-40s .
docker run -d --name roteirista-40s --restart unless-stopped -p 8080:3000 -e USUARIOS="admin:SuaSenha" roteirista-40s
```

Para usar outra porta, troque o `8080` no `docker-compose.yml` (ou no `-p`).

## Hostinger, com tela de login (sem afetar o site principal)

Use o arquivo [`hostinger.yml`](hostinger.yml): no painel da Hostinger, abra **VPS > Docker Manager**, crie um projeto, cole o conteúdo inteiro e clique em **Implantar**.

- **Acessos:** edite a linha `USUARIOS` no formato `usuario:senha`, separando as pessoas por vírgula (sem espaços e sem vírgula dentro da senha). Para adicionar ou remover alguém, edite a linha e implante de novo. Quem sai da lista perde o acesso na hora.
- Tela de login própria, botão **Sair**, sessão de 7 dias e bloqueio de 15 minutos depois de 5 senhas erradas.
- Usa a imagem oficial do Node e baixa os arquivos do GitHub ao ligar: para atualizar, basta reiniciar o container.
- Usa a porta **8081**; as portas 80 e 443 do seu site ficam livres.

Depois abra `http://IP-DO-SEU-VPS:8081`.

## Subdomínio com HTTPS (Traefik)

Use [`hostinger-https.yml`](hostinger-https.yml) no lugar do `hostinger.yml`. Ele segue o mesmo padrão de labels do n8n da Hostinger (entrypoint `websecure`, certresolver `letsencrypt`). Antes de implantar, troque o subdomínio e as senhas. Crie também um registro DNS do tipo **A** do subdomínio apontando para o IP do VPS.

## Atualizar

```bash
cd roteirista
git pull
docker compose up -d --build
```

## Domínio com HTTPS (opcional)

Aponte o domínio para o servidor e coloque um proxy na frente do container. Com o [Caddy](https://caddyserver.com), que emite o certificado sozinho, o `/etc/caddy/Caddyfile` fica assim:

```
roteiros.seudominio.com {
    reverse_proxy 127.0.0.1:8080
}
```

## Verificar se está no ar

`http://IP-DO-SERVIDOR:8080/saude` responde `ok`. O container também tem healthcheck: `docker ps` mostra `healthy`.

## Arquivos

```
servidor.js          servidor com tela de login (Node, sem dependências)
public/index.html    o Roteirista (interface, motor de roteiros e teleprompter)
public/login.html    a tela de login
hostinger.yml        instalação na Hostinger, sem build
Dockerfile           imagem baseada em node:alpine
docker-compose.yml   sobe o container na porta 8080
```
