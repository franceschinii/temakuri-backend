# Plano (backend): Pagamento Real (Mercado Pago) + Premium

> Branch: `feat/payments-premium`. Esta é a parte **backend** do plano. Para a parte UI, ver `temakuri-frontend/docs/payments-premium.md`.

---

## Caminho passo-a-passo do Mercado Pago

### Painel MP (configuração manual)

1. **mercadopago.com.br** → criar/logar conta. **Recomendo CNPJ (MEI)** — conta empresarial cumpre IR melhor; pessoa física tem limite mensal e complica imposto.
2. Painel → **Suas integrações** (`https://www.mercadopago.com.br/developers/panel/app`) → **Criar aplicação** "Temakuri".
3. Dentro da app, ir em **Credenciais de produção** (e **Credenciais de teste** ao lado):
   - **Public Key** (frontend, `APP_USR-` ou `TEST-`)
   - **Access Token** (backend secreto, `APP_USR-` ou `TEST-`)
4. Preencher dados fiscais (conta bancária para receber, endereço) — MP bloqueia produção até completar.
5. Configurar **Webhooks** na aplicação:
   - URL: `https://<domínio>/payments/webhooks/mercadopago`
   - Eventos: `payment`, `subscription_preapproval`, `subscription_authorized_payment`
6. Salvar credenciais no `.env.production` do backend (NUNCA no git).

---

## Decisões pendentes (de você)

- **(D1) Domínio HTTPS do backend** para webhook (ex: `https://api.temakuri.com.br`). Sem isso, MP não consegue chamar callback.
- **(D2) Renovação Premium**: assinatura automática (só cartão) **OU** manual com PIX/cartão (jogador clica todo mês). **Sugiro manual com PIX** porque BR.
- **(D3) Modos liberados pelo Premium**: temporário (durante assinatura) **OU** permanente (single-shot). **Sugiro temporário**.
- **(D4) Quando creditar 50 diamantes/mês**: dia 1 do mês **OU** aniversário da assinatura. **Sugiro aniversário** — evita rush no dia 1.
- **(D5) Conta MP pronta?** Status de produção liberada?
- **(D6) Avatares**: SVG geométricos feitos por mim (estilizados, não realistas), está OK?

---

## Variáveis de ambiente (`.env.production`)

```env
MP_ACCESS_TOKEN=APP_USR-xxxxx
MP_PUBLIC_KEY=APP_USR-xxxxx
MP_WEBHOOK_SECRET=string_aleatoria_que_voce_gera
APP_BASE_URL=https://temakuri.com.br
APP_API_URL=https://api.temakuri.com.br
```

`MP_WEBHOOK_SECRET`: gerar com `openssl rand -hex 32`. Usado para validar assinatura.

---

## Modelo de dados (Prisma — migration nova)

```prisma
model User {
  // ... campos existentes ...
  diamonds            Int       @default(0)
  isPremium           Boolean   @default(false)
  premiumExpiresAt    DateTime?
  lastPremiumGrantAt  DateTime?
  diamondTransactions DiamondTransaction[]
  premiumSubscriptions PremiumSubscription[]
}

model UserInventory {
  // ... campos existentes ...
  unlockedThemes      String[] @default([])
}

model DiamondTransaction {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type          String   // 'PURCHASE' | 'SPEND' | 'PREMIUM_GRANT' | 'REFUND' | 'ADMIN_GRANT'
  amount        Int      // positivo ou negativo
  description   String?
  mpPaymentId   String?  @unique // idempotência
  sku           String?
  metadata      Json?
  createdAt     DateTime @default(now())

  @@index([userId, createdAt])
}

model PremiumSubscription {
  id              String    @id @default(uuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  status          String    // 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING'
  startedAt       DateTime  @default(now())
  expiresAt       DateTime
  mpPreapprovalId String?
  mpPaymentId     String?   @unique
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([userId, status])
  @@index([expiresAt])
}
```

---

## Catálogo de produtos (hardcoded em service)

### Pacotes de diamantes

| SKU | Diamantes | Preço (R$) | Centavos | Bônus |
|---|---|---|---|---|
| `DIAMONDS_100` | 100 | 4,90 | 490 | — |
| `DIAMONDS_500` | 500 | 19,90 | 1990 | +2% |
| `DIAMONDS_1200` | 1.200 | 39,90 | 3990 | +22% |
| `DIAMONDS_3000` | 3.000 | 89,90 | 8990 | +50% |

### Premium

| SKU | Preço (R$) | Duração | Benefícios |
|---|---|---|---|
| `PREMIUM_MONTHLY` | 7,90 | 30 dias | 50 diamantes mensais, sem ads, todos os modos liberados |

---

## Estrutura de código (backend)

```
src/
├── payments/
│   ├── payments.module.ts
│   ├── payments.controller.ts        # POST /payments/diamonds/checkout, /payments/premium/checkout
│   ├── payments.service.ts           # Lógica de criar preferência MP, créditos atômicos
│   ├── webhooks.controller.ts        # POST /payments/webhooks/mercadopago
│   ├── mercadopago.service.ts        # Wrapper SDK MP
│   ├── diamond-catalog.ts            # SKUs hardcoded
│   └── premium.service.ts            # Lógica de assinatura
├── premium/
│   └── premium.cron.ts               # Cron diário (expiração + créditos mensais)
└── ...
```

---

## Fluxos

### Fluxo 1: Comprar pacote de diamantes (Checkout Pro)

1. Frontend: `POST /payments/diamonds/checkout` com `{ sku: 'DIAMONDS_500' }`.
2. Backend cria `Preference` no MP:
   ```ts
   {
     items: [{ title: '500 Diamantes', quantity: 1, unit_price: 19.90 }],
     external_reference: `diamonds-${user.id}-${sku}-${Date.now()}`,
     notification_url: `${APP_API_URL}/payments/webhooks/mercadopago`,
     back_urls: {
       success: `${APP_BASE_URL}/payments/success`,
       failure: `${APP_BASE_URL}/payments/failure`,
       pending: `${APP_BASE_URL}/payments/pending`,
     },
     auto_return: 'approved',
   }
   ```
3. Retorna `{ checkoutUrl: preference.init_point }` para o frontend.
4. Usuário paga no MP (PIX, cartão, etc.).
5. MP chama `POST /payments/webhooks/mercadopago`.
6. Webhook:
   - Valida assinatura (`x-signature` header) via `MP_WEBHOOK_SECRET`.
   - Consulta MP API com `payment.id` para confirmar status `approved`.
   - Parseia `external_reference` para extrair `userId` e `sku`.
   - Transação atômica: verifica idempotência via `mpPaymentId @unique`, cria `DiamondTransaction`, incrementa `user.diamonds`.

### Fluxo 2: Assinar Premium (D2 = manual com PIX)

1. `POST /payments/premium/checkout` com `{ sku: 'PREMIUM_MONTHLY' }`.
2. `external_reference` = `premium-${user.id}-${Date.now()}`.
3. Webhook detecta `external_reference` começando com `premium-`:
   - Cria `PremiumSubscription { status: 'ACTIVE', expiresAt: now+30d }`.
   - Se já tem ativa: estende `expiresAt += 30d`.
   - Atualiza `user.isPremium = true`, `user.premiumExpiresAt = expiresAt`.
   - Credita 50 diamantes via `DiamondTransaction { type: 'PREMIUM_GRANT' }`.
   - Atualiza `user.lastPremiumGrantAt = now`.

### Fluxo 3: Cron diário (03:00)

**A) Expira assinaturas vencidas:**
```sql
UPDATE User SET isPremium = false 
WHERE isPremium = true AND premiumExpiresAt < NOW();
```

**B) Credita 50 diamantes mensais (D4 = aniversário):**

Para cada User onde `isPremium=true` E `lastPremiumGrantAt < now - 30d`:
- Cria `DiamondTransaction { type: 'PREMIUM_GRANT', amount: +50 }`.
- `user.diamonds += 50`.
- `user.lastPremiumGrantAt = now`.

### Fluxo 4: Modos liberados pelo Premium (D3 = temporário)

Em `rooms.service.ts` no `joinRoom` e `create`:

```ts
if (!existing && room.mode !== 'TRADITIONAL') {
  const isPremiumActive = joiner.isPremium && joiner.premiumExpiresAt && joiner.premiumExpiresAt > new Date();
  if (!isPremiumActive) {
    const inv = await this.prisma.userInventory.findUnique(...);
    if (!inv || !inv.unlockedModes.includes(room.mode)) {
      throw new ForbiddenException(...);
    }
  }
}
```

---

## Segurança

1. **Webhook valida assinatura MP** via `x-signature` header.
2. **Webhook consulta MP API** antes de creditar (não confia no payload).
3. **Idempotência** por `mpPaymentId @unique` na `DiamondTransaction`.
4. **Transação Prisma atômica** em todo crédito/débito.
5. **Endpoint `/payments/*/checkout` exige JWT**.
6. **Endpoint webhook SEM JWT** (MP não passa) mas valida assinatura.
7. **Rate limit no checkout** (3 req/min por user).

---

## Plano de execução (3 commits na branch `feat/payments-premium`)

### Commit 1 — Estrutura + ícone diamante
- Migration Prisma: campos novos no User + models `DiamondTransaction`, `PremiumSubscription`.
- Endpoint admin `POST /admin/credit-diamonds`.
- Build + tests + commit + push.

### Commit 2 — Catálogo expandido (sem MP ainda)
- Catálogo de pacotes + temas + avatares premium no backend.
- Endpoints `POST /shop/purchase-theme`, `POST /shop/purchase-premium-avatar` (gasto em diamantes existentes).
- Build + tests + commit + push.

### Commit 3 — Mercado Pago integrado
- `npm i mercadopago`.
- `PaymentsModule` completo.
- Endpoints `/payments/diamonds/checkout`, `/payments/premium/checkout`, `/payments/webhooks/mercadopago`.
- Cron daily (`@nestjs/schedule`).
- Build + tests + commit + push.

---

## Verificação

### Testes automatizados

- Unit tests `PaymentsService`, `WebhooksController` (idempotência + assinatura inválida), `PremiumService` (extensão de prazo, cron).

### Testes manuais (sandbox MP)

1. Comprar 100 diamantes via PIX simulado → confirmar crédito no DB.
2. Pagar com cartão de teste MP (`5031 4332 1540 6351`) → confirmar crédito.
3. Webhook duplicado (curl manual) → confirmar idempotência.
4. Assinar Premium → verificar campos + +50 diamantes.
5. Cron manual após 30 dias → verificar +50 diamantes.
6. Forçar `premiumExpiresAt = now-1d` → cron → `isPremium=false`.

---

## Riscos

| Risco | Mitigação |
|---|---|
| Webhook MP atrasa (PIX leva minutos) | Rota `/payments/pending` com polling de `/auth/me` |
| Chargeback | Webhook `payment.updated` com status `cancelled/refunded`. Backend debita diamantes não-gastos |
| MP API fora do ar | Endpoint retorna 503; frontend mostra "Tente novamente" |
| Premium vence em partida | Sala já criada continua; próxima joinRoom em modo pago falha |
| Diamantes negativos por bug | Constraint `diamonds >= 0`. Toda decrement em transação valida saldo antes |

---

## Não vai ser feito agora

- Assinatura automática via `/preapproval` (a menos que D2 mude)
- Boleto bancário (PIX + cartão cobrem 95%)
- Refund automático via API MP (manual no painel se precisar)
- Stripe alternativo (depois, se tiver demanda internacional)
