-- Migracao: overrides de preco de catalogo editaveis pelo admin.
-- Tabela vazia por padrao — sem override, o codigo usa o default
-- hardcoded. Nenhuma mudanca de comportamento na criacao.

CREATE TABLE "CatalogPrice" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogPrice_kind_key_key" ON "CatalogPrice"("kind", "key");
CREATE INDEX "CatalogPrice_kind_idx" ON "CatalogPrice"("kind");
