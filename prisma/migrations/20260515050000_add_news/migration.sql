-- Tabela de noticias gerenciaveis pelo admin (espelha ChangelogEntry).
-- O seed inicial (migrando a noticia hardcoded) eh feito pelo
-- NewsService.seedIfEmpty no primeiro boot.

CREATE TABLE "NewsEntry" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NewsEntry_published_sortIndex_idx" ON "NewsEntry"("published", "sortIndex");
