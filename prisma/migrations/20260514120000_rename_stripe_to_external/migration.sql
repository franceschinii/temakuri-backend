-- Migracao: renomeia campos especificos do Stripe para nomes provider-agnosticos.
-- Motivo: troca de Stripe por Mercado Pago. Como PAYMENTS_ENABLED nunca foi true,
-- nao ha dados em producao. Migracao e um rename direto.

-- User
ALTER INDEX "User_stripeCustomerId_key" RENAME TO "User_externalCustomerId_key";
ALTER TABLE "User" RENAME COLUMN "stripeCustomerId" TO "externalCustomerId";

-- DiamondTransaction
ALTER INDEX "DiamondTransaction_stripeSessionId_key" RENAME TO "DiamondTransaction_externalPaymentId_key";
ALTER INDEX "DiamondTransaction_stripeInvoiceId_key" RENAME TO "DiamondTransaction_externalInvoiceId_key";
ALTER TABLE "DiamondTransaction" RENAME COLUMN "stripeSessionId" TO "externalPaymentId";
ALTER TABLE "DiamondTransaction" RENAME COLUMN "stripeInvoiceId" TO "externalInvoiceId";

-- PremiumSubscription
ALTER INDEX "PremiumSubscription_stripeSubscriptionId_key" RENAME TO "PremiumSubscription_externalSubscriptionId_key";
ALTER TABLE "PremiumSubscription" RENAME COLUMN "stripeSubscriptionId" TO "externalSubscriptionId";
ALTER TABLE "PremiumSubscription" RENAME COLUMN "stripeCustomerId" TO "externalCustomerId";
