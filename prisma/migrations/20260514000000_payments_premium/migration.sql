-- AlterTable: User ganha campos de pagamento/premium
ALTER TABLE "User" ADD COLUMN "diamonds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "premiumExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lastPremiumGrantAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN "activeTheme" TEXT;

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- AlterTable: UserInventory ganha unlockedThemes
ALTER TABLE "UserInventory" ADD COLUMN "unlockedThemes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable: DiamondTransaction
CREATE TABLE "DiamondTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "stripeSessionId" TEXT,
    "stripeInvoiceId" TEXT,
    "sku" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiamondTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiamondTransaction_stripeSessionId_key" ON "DiamondTransaction"("stripeSessionId");
CREATE UNIQUE INDEX "DiamondTransaction_stripeInvoiceId_key" ON "DiamondTransaction"("stripeInvoiceId");
CREATE INDEX "DiamondTransaction_userId_createdAt_idx" ON "DiamondTransaction"("userId", "createdAt");

ALTER TABLE "DiamondTransaction" ADD CONSTRAINT "DiamondTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: PremiumSubscription
CREATE TABLE "PremiumSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PremiumSubscription_stripeSubscriptionId_key" ON "PremiumSubscription"("stripeSubscriptionId");
CREATE INDEX "PremiumSubscription_userId_status_idx" ON "PremiumSubscription"("userId", "status");
CREATE INDEX "PremiumSubscription_expiresAt_idx" ON "PremiumSubscription"("expiresAt");

ALTER TABLE "PremiumSubscription" ADD CONSTRAINT "PremiumSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
