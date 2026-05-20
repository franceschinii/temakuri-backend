-- Catch-up migration: cria a tabela "UserInventory".
--
-- A tabela nunca teve um CREATE TABLE no historico de migrations — so um
-- ALTER TABLE em 20260514000000_payments_premium, que assume a tabela ja
-- existente. Em bancos limpos isso faz `migrate deploy` quebrar (P3018).
--
-- Esta migration tem timestamp ANTERIOR a payments_premium para rodar antes
-- dela em bancos limpos. E idempotente: em bancos onde a tabela ja existe
-- (producao, criada via `db push`), todo o SQL e no-op.
--
-- "unlockedThemes" NAO entra aqui de proposito — quem adiciona essa coluna e
-- a 20260514000000_payments_premium. Assim o estado final bate com o schema.

CREATE TABLE IF NOT EXISTS "UserInventory" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "unlockedAvatars" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3],
    "unlockedModes"   TEXT[]    DEFAULT ARRAY['TRADITIONAL']::TEXT[],
    CONSTRAINT "UserInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserInventory_userId_key"
    ON "UserInventory"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserInventory_userId_fkey'
  ) THEN
    ALTER TABLE "UserInventory"
      ADD CONSTRAINT "UserInventory_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
