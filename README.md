# Temakuri — Backend

## Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run start:dev
```

Servidor sobe em http://localhost:3001
Docs Swagger em http://localhost:3001/docs
WebSocket em ws://localhost:3001/ws?token=<JWT>

## Variáveis de ambiente

| Var | Valor padrão | Descrição |
|-----|-------------|-----------|
| DATABASE_URL | - | URL do Postgres (ex.: `postgresql://user:pass@host:5432/temakuri`) |
| JWT_SECRET | - | Segredo do access token |
| JWT_REFRESH_SECRET | - | Segredo do refresh token |
| JWT_EXPIRES_IN | 15m | Expiração do access token |
| JWT_REFRESH_EXPIRES_IN | 7d | Expiração do refresh token |
| FRONTEND_URL | http://localhost:5173 | CORS origin |
| PORT | 3001 | Porta do servidor |

## Rodando testes

167 testes em 4 camadas (motor / HTTP / WebSocket gateway / flow E2E). Design completo em [`docs/superpowers/specs/2026-05-12-test-coverage-design.md`](docs/superpowers/specs/2026-05-12-test-coverage-design.md), com planos por camada em [`docs/superpowers/plans/`](docs/superpowers/plans/).

### Unit (motor do jogo — 92 testes)

Não toca o banco, roda em segundos:

```bash
npm test            # uma vez
npm run test:watch  # watch mode
```

### E2E (HTTP + WS Gateway + Flow — 75 testes)

Requer um Postgres acessível **em uma porta separada do DB de dev** — o teste usa o banco `temakuri_test` e dropa/recria dados.

```bash
cp .env.test.example .env.test    # ajusta DATABASE_URL conforme seu setup
npm run test:e2e                  # roda uma vez
npm run test:e2e:watch            # watch mode
```

Você precisa criar o DB `temakuri_test` uma vez (o `prisma db push` cuida do schema):

```bash
# Se estiver usando o docker-compose do projeto:
docker compose exec postgres psql -U temakuri -d temakuri -c "CREATE DATABASE temakuri_test;"

# Postgres nativo:
psql -U postgres -c "CREATE DATABASE temakuri_test;"
```

> **Nota temporária**: o setup usa `prisma db push` em vez de `migrate deploy` porque há drift entre `schema.prisma` e `prisma/migrations/`. Trocar pra `migrate deploy` assim que a migration catch-up for commitada.

> Há também uma 5ª camada Playwright (~18 testes de bots jogando) no [repo temakuri-frontend](https://github.com/franceschinii/temakuri-frontend#rodando-testes), que roda contra esta stack.
