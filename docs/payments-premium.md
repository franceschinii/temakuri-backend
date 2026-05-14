# Plano (backend): Pagamento Real (Stripe) + Premium + Diamantes

> Branch: `feat/payments-premium`. Esta é a parte **backend** do plano.
> Para a parte UI, ver `temakuri-frontend/docs/payments-premium.md`.
> Plano mestre: `~/.claude/plans/cara-no-celular-a-shimmering-cosmos.md`.

---

## Estratégia em duas fases

**Fase A — agora (sem Stripe ativo):**
Infra completa criada (campos do User, models DiamondTransaction/PremiumSubscription, endpoints, feature flag). `PAYMENTS_ENABLED=false` faz os endpoints retornarem 503. Admin pode creditar diamantes manualmente pra testes. Catálogo de itens pra gastar diamante (avatares premium, temas, etc.) já fica disponível — botões aparecem com "Em breve" no frontend.

**Fase B — quando Stripe estiver configurado:**
Setar `PAYMENTS_ENABLED=true` e preencher as 7 env vars. Webhook + Checkout entram em ação. Mudança de configuração, sem código novo.

---

## Configuração no painel Stripe

1. **dashboard.stripe.com** → criar conta. Recomendado **CNPJ (MEI)** pra IR mais limpo.
2. Modo de teste → começar tudo aqui.
3. **Produtos** (5 ao todo):
   - `DIAMONDS_100` — R$ 4,90 one-time
   - `DIAMONDS_500` — R$ 19,90 one-time
   - `DIAMONDS_1200` — R$ 39,90 one-time
   - `DIAMONDS_3000` — R$ 89,90 one-time
   - `PREMIUM_MONTHLY` — R$ 7,90/mês recurring
4. **Anotar os `price_id`** (`price_XXX`) — vão direto pras env vars.
5. **API Keys** (Developers → API keys):
   - Publishable key (frontend, `pk_test_...` / `pk_live_...`)
   - Secret key (backend, `sk_test_...` / `sk_live_...`)
6. **Webhooks** (Developers → Webhooks → Add endpoint):
   - URL: `https://api.temakuri.com.br/payments/webhooks/stripe`
   - Eventos:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
   - Pegar **Signing Secret** (`whsec_...`).
7. **Customer Portal** (Settings → Billing → Customer portal) → habilitar com cancelamento.
8. **Pagamentos aceitos** (Settings → Payment methods): Card + Pix (Pix só pra one-time).
9. **Dados fiscais** (Settings → Business → Tax) — CNPJ/CPF preenchidos.

---

## Variáveis de ambiente (`.env.production`)

```env
# Feature flag — quando false, endpoints /payments/* retornam 503
PAYMENTS_ENABLED=false

# Stripe (preencher na Fase B)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_DIAMONDS_100=price_xxx
STRIPE_PRICE_DIAMONDS_500=price_xxx
STRIPE_PRICE_DIAMONDS_1200=price_xxx
STRIPE_PRICE_DIAMONDS_3000=price_xxx
STRIPE_PRICE_PREMIUM_MONTHLY=price_xxx

APP_BASE_URL=https://temakuri.com.br
APP_API_URL=https://api.temakuri.com.br
```

---

## Modelo de dados (migration nova)

```prisma
model User {
  // existentes...
  diamonds              Int       @default(0)
  premiumExpiresAt      DateTime?
  lastPremiumGrantAt    DateTime?
  stripeCustomerId      String?   @unique
  activeTheme           String?
  diamondTransactions   DiamondTransaction[]
  premiumSubscriptions  PremiumSubscription[]
}

model UserInventory {
  // existentes...
  unlockedThemes        String[] @default([])
}

model DiamondTransaction {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type            String   // 'PURCHASE' | 'SPEND' | 'PREMIUM_GRANT' | 'REFUND' | 'ADMIN_GRANT'
  amount          Int      // positivo ou negativo
  description     String?
  stripeSessionId String?  @unique  // idempotência one-time
  stripeInvoiceId String?  @unique  // idempotência renovação premium
  sku             String?
  metadata        Json?
  createdAt       DateTime @default(now())

  @@index([userId, createdAt])
}

model PremiumSubscription {
  id                   String    @id @default(uuid())
  userId               String
  user                 User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  status               String    // 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED'
  startedAt            DateTime  @default(now())
  expiresAt            DateTime  // current_period_end
  cancelAtPeriodEnd    Boolean   @default(false)
  stripeSubscriptionId String    @unique
  stripeCustomerId     String
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([userId, status])
  @@index([expiresAt])
}
```

`User.isPremium` boolean continua sendo a fonte rápida pra checks (AdBanner, AppNavbar). É derivado de `premiumExpiresAt > now`; cron diário sincroniza.

---

## Catálogo (`src/payments/catalog.ts`)

```ts
export const DIAMOND_PACKS = {
  DIAMONDS_100:  { diamonds: 100,  priceBrl: 4.90,  bonus: 0 },
  DIAMONDS_500:  { diamonds: 500,  priceBrl: 19.90, bonus: 2 },
  DIAMONDS_1200: { diamonds: 1200, priceBrl: 39.90, bonus: 22 },
  DIAMONDS_3000: { diamonds: 3000, priceBrl: 89.90, bonus: 50 },
};

export const PREMIUM_PACK = {
  PREMIUM_MONTHLY: { priceBrl: 7.90, diamondsPerMonth: 50 },
};
```

Mapeamento SKU → `stripePriceId` vem de `process.env`.

### Catálogo de gasto de diamantes (no `ShopService`)

Preços calibrados pra ficarem **abaixo da metade** do pack `DIAMONDS_100` (50 💎) em itens básicos.

| SKU | Preço (💎) | Tipo |
|---|---|---|
| `PREMIUM_AVATAR_9` (Yokai) | 30 | avatar premium |
| `PREMIUM_AVATAR_10` (Kitsune) | 30 | avatar premium |
| `PREMIUM_AVATAR_11` (Tanuki) | 30 | avatar premium |
| `PREMIUM_AVATAR_12` (Geisha) | 80 | avatar premium |
| `PREMIUM_AVATAR_13` (Samurai) | 80 | avatar premium |
| `PREMIUM_AVATAR_14` (Dragão Dourado) | 300 | avatar premium |
| `THEME_BAMBU` | 50 | tema mesa |
| `THEME_SAKURA` | 100 | tema mesa |
| `THEME_ONI` | 150 | tema mesa |
| `RESET_RANKED_WARNINGS` | 20 | utilitário |
| `RESET_LOSS_STREAK` | 10 | utilitário |
| `COIN_PACK_50` | 5 → +50 coins | conversão |
| `COIN_PACK_200` | 15 → +200 coins | conversão |
| `COIN_PACK_700` | 40 → +700 coins | conversão |

---

## Estrutura de código

```
src/
├── payments/
│   ├── payments.module.ts
│   ├── payments.controller.ts        # POST /payments/diamonds/checkout, /premium/checkout, /portal
│   ├── payments.service.ts           # createCheckoutSession, createPortalSession; respeita flag
│   ├── webhooks.controller.ts        # POST /payments/webhooks/stripe (rawBody)
│   ├── stripe.service.ts             # Wrapper SDK
│   ├── catalog.ts                    # SKUs
│   └── premium.service.ts            # Lógica de grant/expire/renew
├── premium/
│   └── premium.cron.ts               # Cron diário 03:00
└── shop/
    ├── shop.service.ts               # +SKUs em diamantes
    └── shop.controller.ts            # +endpoints
```

---

## Fluxos

### Comprar pacote de diamantes

1. `POST /payments/diamonds/checkout { sku: 'DIAMONDS_500' }` (JWT).
2. Se `PAYMENTS_ENABLED=false` → 503.
3. Backend cria `stripe.checkout.sessions.create({ mode: 'payment', line_items, success_url, cancel_url, client_reference_id: userId, metadata: { sku, userId } })`.
4. Retorna `{ url: session.url }`. Frontend redireciona.
5. Webhook `checkout.session.completed`:
   - Valida `stripe-signature`.
   - Idempotência via `stripeSessionId @unique` em `DiamondTransaction`.
   - Transação atômica: cria `DiamondTransaction { type: 'PURCHASE', amount: +diamonds }`, incrementa `User.diamonds`.

### Assinar Premium

1. `POST /payments/premium/checkout` (JWT).
2. Backend cria session com `mode: 'subscription'`. Só cartão (Stripe não permite Pix recorrente).
3. Webhook `customer.subscription.created` → cria `PremiumSubscription`, define `expiresAt = current_period_end`.
4. Webhook `invoice.paid` (primeira + renovações) → estende `expiresAt`, credita 50 💎 com `DiamondTransaction { type: 'PREMIUM_GRANT', stripeInvoiceId @unique }`, atualiza `User.isPremium=true`, `premiumExpiresAt`, `lastPremiumGrantAt`.
5. Webhook `customer.subscription.deleted` → `status='CANCELLED'`, mantém `expiresAt`.

### Customer Portal

1. `POST /payments/portal` (JWT) → `stripe.billingPortal.sessions.create({ customer, return_url })`.
2. Retorna `{ url }`. User cancela/atualiza cartão lá. Webhook sincroniza.

### Cron diário (03:00)

`@nestjs/schedule`:

```ts
@Cron('0 3 * * *')
async syncPremium() {
  const now = new Date();
  await prisma.user.updateMany({
    where: { isPremium: true, premiumExpiresAt: { lt: now } },
    data: { isPremium: false },
  });
  await prisma.premiumSubscription.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
}
```

Grant de 50 💎 é por `invoice.paid` (não cron) — Stripe garante exatamente um por período.

### Modos liberados pelo Premium

Em `rooms.service.ts` no `create` e `joinRoom`:

```ts
if (room.mode !== 'TRADITIONAL') {
  const isPremiumActive = user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt > new Date();
  if (!isPremiumActive) {
    const inv = await prisma.userInventory.findUnique({ where: { userId } });
    if (!inv?.unlockedModes.includes(room.mode)) {
      throw new ForbiddenException('Modo bloqueado — Premium ou desbloqueio em coins.');
    }
  }
}
```

---

## Segurança

1. Webhook valida `stripe-signature` com `STRIPE_WEBHOOK_SECRET`. Falha = 400.
2. Webhook sem JWT guard (Stripe não passa) — só signature.
3. Idempotência em `DiamondTransaction` via `stripeSessionId @unique` e `stripeInvoiceId @unique`.
4. Toda mutação de saldo em `prisma.$transaction()` atômica.
5. Endpoint webhook respeita `PAYMENTS_ENABLED` antes de mutar dados — defensive.
6. `/payments/*/checkout` exige JWT.
7. Rate limit 3 req/min/user no checkout.
8. `main.ts` configurado com rawBody para webhook (Express raw body necessário para `constructEvent`).

---

## Bugs corrigidos junto

1. **Admin kick não desconecta sessão**: `adminKickPlayer` (`src/admin/admin.service.ts:95`) só deletava `roomPlayer`. Fix: chama `roomsService.leaveRoom(userId, code)` + emite evento `admin.kicked` que disconnecta o socket no gateway.
2. **`tricksWon` / `saborTriggers`** já corrigidos em `0.5.4`. Mantido como referência.

---

## Plano de execução

### Fase A

1. **Commit 1**: Fix admin kick + (frontend) fix gameStore.selectedIndices + RoundSummary auto-close + Como jogar universal desktop.
2. **Commit 2**: Migration + DiamondDisplay + admin credit-diamonds.
3. **Commit 3**: Catálogo expandido (avatares 9-14, temas, SKUs em diamantes no ShopService).
4. **Commit 4**: PaymentsModule + webhook + cron + feature flag.
5. **Commit 5**: Bump 0.6.0-beta + changelog + PR draft.

### Fase B

1. Setar `PAYMENTS_ENABLED=true` + chaves Stripe.
2. Validar com Stripe CLI.
3. Cenários manuais.
4. Changelog Fase B.

---

## Verificação

Ver plano mestre. Resumo:
- Typecheck back/front sem erros novos.
- `npx prisma migrate dev --name payments_premium` local.
- Stripe CLI: `stripe listen --forward-to localhost:3001/api/v1/payments/webhooks/stripe` + `stripe trigger checkout.session.completed`.
- Cartão `4242 4242 4242 4242`.
- Webhook replay → idempotência.

---

## Não vai ser feito

- Boleto bancário (Pix + cartão = 95%).
- Refund automático via API.
- Mercado Pago alternativo.
- App nativo iOS/Android.
