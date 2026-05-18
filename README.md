# Temakuri — Backend

API REST + WebSocket Gateway do jogo de cartas multiplayer Temakuri. NestJS 11, PostgreSQL com Prisma, autenticação JWT com refresh token, pagamentos via Mercado Pago.

**Repositório frontend:** [temakuri-frontend](https://github.com/franceschinii/temakuri-frontend)

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | NestJS 11 |
| Linguagem | TypeScript 5.7 |
| Banco de dados | PostgreSQL + Prisma 6 |
| Autenticação | JWT (access + refresh) via Passport |
| Tempo real | WebSocket (`@nestjs/platform-ws`) |
| Validação | `class-validator` + `class-transformer` |
| Documentação | Swagger (`@nestjs/swagger`) |
| Email | Nodemailer |
| Pagamentos | Mercado Pago SDK |
| Testes unitários | Jest 30 + `@nestjs/testing` |
| Testes E2E | Jest + Supertest |

---

## Setup

```bash
npm install
cp .env.example .env        # edite DATABASE_URL, JWT_SECRET e JWT_REFRESH_SECRET
npm run db:migrate          # cria as tabelas
npm run start:dev           # hot reload
```

| Serviço | URL |
|---------|-----|
| API REST | `http://localhost:3001/api/v1` |
| Swagger | `http://localhost:3001/docs` |
| WebSocket | `ws://localhost:3001/ws?token=<JWT>` |

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `DATABASE_URL` | — | `postgresql://user:pass@host:5432/temakuri` |
| `JWT_SECRET` | — | Segredo do access token (troque em produção) |
| `JWT_REFRESH_SECRET` | — | Segredo do refresh token |
| `JWT_EXPIRES_IN` | `15m` | TTL do access token |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | TTL do refresh token |
| `FRONTEND_URL` | `http://localhost:5173` | Origin permitida pelo CORS (separe múltiplos por vírgula) |
| `PORT` | `3001` | Porta do servidor |
| `NODE_ENV` | `development` | Ambiente |
| `PAYMENTS_ENABLED` | `false` | Habilita endpoints de pagamento |
| `MP_ACCESS_TOKEN` | — | Token de acesso Mercado Pago |
| `MP_WEBHOOK_SECRET` | — | Secret para validar webhooks do Mercado Pago |
| `MP_PREAPPROVAL_PLAN_ID_PREMIUM` | — | ID do plano de assinatura premium no MP |
| `MP_USE_SANDBOX` | `false` | Usa sandbox do Mercado Pago |

---

## Estrutura de módulos

```
src/
├── main.ts                  # Bootstrap: CORS, WsAdapter, ValidationPipe, Swagger
├── app.module.ts            # Módulo raiz — importa todos os módulos
├── prisma/                  # PrismaService (singleton) e PrismaModule
├── auth/                    # Login, registro, guest, refresh token, reset senha
│   ├── strategies/          # JwtStrategy, LocalStrategy (Passport)
│   ├── guards/              # JwtAuthGuard
│   ├── decorators/          # @CurrentUser()
│   └── dto/                 # LoginDto, RegisterDto, RefreshDto...
├── rooms/                   # REST: criar, listar, entrar em salas
├── game/                    # Motor do jogo
│   ├── engine/              # Lógica pura: turnos, validação de jogadas, sabor
│   └── room-manager.ts      # Estado em memória das partidas ativas
├── matchmaking/             # Fila de matchmaking e emparelhamento
├── notifications/           # Gateway WebSocket (eventos em tempo real)
├── profile/                 # Stats, inventário, histórico de partidas
├── shop/                    # Catálogo, compra de avatares/modos/temas
├── payments/                # Webhook Mercado Pago, checkout de diamantes e premium
├── coupons/                 # CRUD de cupons, validação de desconto
├── admin/                   # Endpoints admin: usuários, conteúdo, preços
├── changelog/               # Notas de versão (CRUD admin + leitura pública)
├── news/                    # Notícias (CRUD admin + leitura pública)
└── reviews/                 # Avaliações de jogadores e reações
```

---

## Endpoints principais

Documentação interativa completa em `/docs` (Swagger).

### Auth — `/api/v1/auth`

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/login` | Login com email e senha |
| `POST` | `/register` | Cadastro de novo usuário |
| `POST` | `/guest` | Login como convidado (sem email) |
| `POST` | `/refresh` | Renovar access token via refresh token |
| `POST` | `/logout` | Invalidar refresh token |
| `GET` | `/me` | Dados do usuário autenticado |
| `POST` | `/forgot-password` | Enviar email de redefinição |
| `POST` | `/reset-password` | Redefinir senha com token |

### Rooms — `/api/v1/rooms`

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Listar salas públicas abertas |
| `POST` | `/` | Criar nova sala |
| `GET` | `/:code` | Detalhes de uma sala pelo código |
| `DELETE` | `/:code` | Fechar sala (host ou admin) |

### WebSocket — `ws://host/ws?token=<JWT>`

Eventos emitidos pelo servidor:

| Evento | Descrição |
|--------|-----------|
| `lobby:public_rooms_changed` | Lista de salas públicas mudou |
| `room:state` | Estado atualizado da sala de espera |
| `game:state` | Estado completo da partida (sync inicial) |
| `game:cards_played` | Jogador lançou cartas |
| `game:turn_passed` | Jogador passou a vez |
| `game:wipe` | Mesa limpa (todos passaram) |
| `game:sabor` | Modo Sabor ativado/desativado |
| `game:round_end` | Rodada encerrada |
| `game:over` | Partida encerrada com ranking |
| `game:reaction` | Emoji enviado por jogador |
| `chat:message` | Mensagem no chat da sala |

---

## Banco de dados

### Schema (Prisma)

| Modelo | Descrição |
|--------|-----------|
| `User` | Conta, stats, gamificação, premium, flags de admin/bot/guest |
| `Session` | Refresh tokens com expiração |
| `UserStats` | Partidas jogadas, vitórias, sabor triggers, vazas |
| `Room` | Salas de jogo: código, modo, status, configurações |
| `RoomPlayer` | Relação User ↔ Room com seat e status |
| `GameResult` | Histórico de partidas: colocação, recompensas, delta PDS |
| `UserInventory` | Avatares, modos e temas desbloqueados por usuário |
| `DiamondTransaction` | Histórico de compras e gastos de diamantes |
| `PremiumSubscription` | Assinaturas via Mercado Pago |
| `RankedStats` | Vitórias/derrotas ranked e peak PDS |
| `Coupon` | Cupons de desconto com validade, limite de uso e escopo |
| `CouponRedemption` | Registro de cupons utilizados |
| `CatalogPrice` | Override de preços do catálogo por chave |
| `ChangelogEntry` | Notas de versão publicadas |
| `NewsEntry` | Notícias com pinagem e publicação |
| `Review` | Avaliações de jogadores com resposta do admin |
| `ReviewReaction` | Reações (helpful / not helpful) por usuário |
| `PasswordResetToken` | Tokens de redefinição de senha com expiração |

### Comandos Prisma

```bash
npm run db:migrate     # prisma migrate dev (cria migration + aplica)
npm run db:generate    # prisma generate (atualiza o client)
npm run db:studio      # abre o Prisma Studio na porta 5555
npm run db:seed        # executa prisma/seed.ts (vazio por padrão)
```

> **Nota:** há drift entre `schema.prisma` e `prisma/migrations/`. Em desenvolvimento, use `prisma db push` se `migrate dev` reclamar de conflito. Em produção, o Dockerfile usa `migrate deploy`.

---

## Deploy

O `Dockerfile` faz o build completo da aplicação:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
```

O `CMD` roda `migrate deploy` antes de iniciar para garantir que o schema está atualizado em cada deploy.

Para a VPS, veja o procedimento de deploy em `~/.claude` (memória de sessão).

---

## Testes

167 testes em 4 camadas. Design completo em [`docs/superpowers/specs/2026-05-12-test-coverage-design.md`](docs/superpowers/specs/2026-05-12-test-coverage-design.md).

### Unit — motor do jogo (92 testes)

Testa a lógica pura de `src/game/engine/` sem banco e sem NestJS:

```bash
npm test             # execução única
npm run test:watch   # watch mode
```

### E2E — HTTP + WebSocket + flow completo (75 testes)

Requer Postgres com banco `temakuri_test` separado do banco de dev:

```bash
# Criar o banco de teste (uma vez):
psql -U postgres -c "CREATE DATABASE temakuri_test;"
# ou via Docker:
docker compose exec postgres psql -U temakuri -c "CREATE DATABASE temakuri_test;"

cp .env.test.example .env.test   # ajuste DATABASE_URL para temakuri_test
npm run test:e2e                  # execução única
npm run test:e2e:watch            # watch mode
```

O `.env.test` usa `PORT=3002` e timeouts reduzidos (`TURN_TIMEOUT_MS=100`, `STARTING_COUNTDOWN_MS=50`) para que os testes rodem rápido sem alterar o banco de dev.

Há também uma 5ª camada Playwright (~18 testes de bots jogando partidas reais) no [repo temakuri-frontend](https://github.com/franceschinii/temakuri-frontend#testes), que roda contra esta stack.
