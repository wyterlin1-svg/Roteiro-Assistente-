# Roteirista 40s

Agente de roteiros de Reels de até 40 segundos, guiado pelo algoritmo do Instagram: gancho nos 3 primeiros segundos, emoção, cortes a cada 3 a 5 segundos, final que emenda no começo e um motivo para mandarem o vídeo para alguém.

- Escreve **todas as falas**, prontas para o teleprompter, e a **direção de câmera** de cada cena.
- Falas fora da caixa: cada roteiro explica o assunto com um objeto do dia a dia que não tem nada a ver com o nicho.
- Funciona para **qualquer pessoa**: sem cadastro, sem chave de API e sem custo por roteiro. Tudo roda no navegador de quem usa.
- Uma página só, servida por um nginx leve.

## Subir no seu servidor (Docker)

Precisa de Docker com Compose no servidor.

```bash
git clone https://github.com/wyterlin1-svg/Roteiro-Assistente-.git roteirista
cd roteirista
docker compose up -d --build
```

Pronto: abra `http://IP-DO-SERVIDOR:8080`.

Sem Compose:

```bash
docker build -t roteirista-40s .
docker run -d --name roteirista-40s --restart unless-stopped -p 8080:80 roteirista-40s
```

Para usar outra porta, troque o `8080` no `docker-compose.yml` (ou no `-p`).

## Hostinger (sem afetar o site principal)

Use o arquivo [`hostinger.yml`](hostinger.yml): no painel da Hostinger, abra **VPS > Docker Manager > Compose**, cole o conteúdo inteiro e clique em **Deploy**. Ele monta o container direto do GitHub, usa a porta **8081** (as portas 80 e 443 do seu site ficam livres) e tem rede, nome e limite de memória próprios.

Depois abra `http://IP-DO-SEU-VPS:8081`.

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
public/index.html    a página inteira (interface, motor de roteiros e teleprompter)
nginx.conf           configuração do servidor web
Dockerfile           imagem baseada em nginx:alpine
docker-compose.yml   sobe o container na porta 8080
```
