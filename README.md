# Roteirista 40s

IA que cria roteiros de Reels do Instagram de até 40 segundos, escritos a partir dos sinais que o algoritmo usa para distribuir vídeos: retenção nos 3 primeiros segundos, tempo assistido, replay, **envios por DM**, salvamentos e comentários. Funciona também quando você está sem nenhuma ideia.

> Nenhuma ferramenta garante que um vídeo vai viralizar. Esta aqui faz cada roteiro cumprir as regras que aumentam essa chance, e audita o resultado antes de você gravar.

## O que tem de diferente

| Ideia | Por que importa |
|---|---|
| **Colisão criativa** 🎲 | Um "dado" sorteia emoção + ângulo + formato + **restrição** que não combinam entre si. A IA precisa resolver essa tensão, e isso tira ela do lugar-comum. Cada dado tem um código (ex.: `#K7P2Q`) que sempre gera a mesma combinação, então dá para repetir o que funcionou. Rolar o dado é local e não custa nada. |
| **Gatilho de envio** 📨 | Todo roteiro define *para quem* o espectador mandaria o vídeo. Envios por DM são o sinal que mais leva um Reel a quem não segue a conta. |
| **Gancho triplo** | Fala (até 12 palavras), texto na tela e ação visual nos 0–3s, com 3 variações para testar em Reels de teste (trial reels). |
| **Loop obrigatório** 🔁 | O final emenda no começo, então o replay parece continuação. |
| **Orçamento de palavras** ⏱ | Cerca de 2,6 palavras por segundo: 40s cabem em no máximo ~100 palavras. Cada cena tem tempo marcado. |
| **Antifórmula** 🚫 | Bloqueia frases típicas de IA ("Você sabia que", "Neste vídeo", "mergulhar", "jornada"…) no prompt e confere de novo localmente. |
| **Viralômetro** 📈 | Nota de 0 a 100 calculada no seu computador, sem custo: gancho, duração, ritmo de cortes, loop, tipo de CTA e originalidade. Se a nota fica abaixo de 65, o roteiro é reescrito **uma vez** automaticamente com os problemas apontados. |
| **Teleprompter** 🎬 | Contagem 3-2-1 e texto que rola no tempo de cada cena. Já dá para gravar dali. |

## Leve, rápido e barato

- Uma única dependência (`@anthropic-ai/sdk`), sem framework e sem banco de dados. O histórico fica no navegador.
- Uma chamada à IA por roteiro (no máximo duas, quando a reescrita automática entra), com resposta em JSON estruturado.
- Cache de prompt no prompt do sistema, esforço de raciocínio `low` por padrão e custo de cada roteiro mostrado na tela.
- O modelo é configurável: `claude-opus-5-5` (padrão, melhor escrita) ou `claude-haiku-5-5` (cerca de 40x mais barato).

## Acesso por login (para vender a clientes)

Cada cliente entra com e-mail e senha. Você administra tudo em `/admin`: cria acessos (com a mensagem pronta para enviar ao cliente), bloqueia, gera nova senha e define quantos roteiros por mês cada um pode gerar. A chave da API fica só no seu servidor.

**Para instalar no seu servidor, siga o [INSTALAR.md](INSTALAR.md)** (Docker ou Node, com HTTPS).

## Rodar no seu computador

Requer Node.js 22 ou superior.

```bash
npm install
cp .env.example .env                                   # coloque sua ANTHROPIC_API_KEY
npm run usuarios -- admin voce@email.com SuaSenha123   # cria seu acesso
npm start                                              # abre em http://localhost:3000
```

Depois de entrar, clique em **"Veja um roteiro de exemplo"** para conhecer a interface e o teleprompter sem gastar nada.

Pelo terminal:

```bash
npm run roteiro -- "finanças pessoais"                          # sem ideia: a colisão cria a ideia
npm run roteiro -- "confeitaria" "bolo que afunda no meio" --duracao 20
npm run roteiro -- "academia" --semente K7P2Q --json
```

Testes: `npm test`

## Estrutura

```
server.js               servidor HTTP (node:http) + API + login
cli.js                  versão de terminal
usuarios.js             gerenciar acessos pelo terminal
public/index.html       interface e teleprompter (um arquivo, sem build)
public/login.html       tela de login
public/admin.html       painel de clientes
src/contas/             usuários (arquivo JSON), senhas e sessões
Dockerfile, docker-compose.yml  instalação no servidor
src/motor/prompt.js     o "cérebro": regras do algoritmo + schema da resposta
src/motor/colisao.js    dado da colisão criativa (determinístico por semente)
src/motor/viralometro.js auditoria local dos roteiros
src/motor/gerar.js      chamada à IA + reescrita automática
src/exemplo.json        roteiro de exemplo (nota 100)
```

## API (requer login)

`POST /api/roteiro` com `{ "nicho": "...", "tema": "", "publico": "", "tom": "", "duracao": 30, "semente": "K7P2Q" }`. Só `nicho` é obrigatório; sem `tema`, entra no modo sem ideia.

`GET /api/dado?s=K7P2Q` devolve a colisão criativa (grátis).
