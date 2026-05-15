-- Migracao: tabela de changelog gerenciada pelo admin.
-- O seed inicial (entradas 0.1.0 ate 0.6.5) e feito em runtime pelo
-- ChangelogService.seedIfEmpty() no boot, lendo de seed-data embutido.

CREATE TABLE "ChangelogEntry" (
  "id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "highlights" TEXT[],
  "details" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "sortIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChangelogEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChangelogEntry_published_sortIndex_idx" ON "ChangelogEntry"("published", "sortIndex");
