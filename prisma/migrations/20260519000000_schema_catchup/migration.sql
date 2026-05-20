-- Catch-up migration: sincroniza o historico de migrations com o schema.prisma.
--
-- Varias colunas e duas tabelas existem no schema.prisma (e em producao,
-- criadas via `prisma db push`) mas nunca tiveram uma migration
-- correspondente. Em qualquer banco limpo (dev novo, CI, restore) o banco
-- montado por `migrate deploy` fica fora de sincronia com o schema e o
-- codigo — ex.: P2022 "column User.isBanned does not exist".
--
-- Esta migration foi gerada a partir de:
--   prisma migrate diff --from-migrations ./prisma/migrations \
--                       --to-schema-datamodel ./prisma/schema.prisma --script
-- e tornada idempotente: todo o SQL e no-op onde o objeto ja existe
-- (producao). Em bancos limpos, cria o que falta. Zero risco no proximo
-- `migrate deploy` de producao.

-- AlterTable: User
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "coins"                INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isBanned"             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isPremium"            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "level"                INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "lossStreak"           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pds"                  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "rankedSuspendedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rankedWarnings"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "suspendedUntil"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "winStreak"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "xp"                   INTEGER NOT NULL DEFAULT 0;

-- AlterTable: GameResult
ALTER TABLE "GameResult"
  ADD COLUMN IF NOT EXISTS "coinsEarned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isRanked"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pdsChange"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "xpEarned"    INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Room
ALTER TABLE "Room"
  ADD COLUMN IF NOT EXISTS "isRanked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "password" TEXT;

-- AlterTable: RoomPlayer
ALTER TABLE "RoomPlayer"
  ADD COLUMN IF NOT EXISTS "sessionWins" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: PasswordResetToken
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "token"     TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RankedStats
CREATE TABLE IF NOT EXISTS "RankedStats" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "rankedWins"   INTEGER NOT NULL DEFAULT 0,
    "rankedLosses" INTEGER NOT NULL DEFAULT 0,
    "peakPds"      INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RankedStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "RankedStats_userId_key" ON "RankedStats"("userId");

-- AddForeignKey (ADD CONSTRAINT nao aceita IF NOT EXISTS — guarda via pg_constraint)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_userId_fkey') THEN
    ALTER TABLE "PasswordResetToken"
      ADD CONSTRAINT "PasswordResetToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RankedStats_userId_fkey') THEN
    ALTER TABLE "RankedStats"
      ADD CONSTRAINT "RankedStats_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
