-- Migracao de dados: o tema/avatar foi renomeado de Corinthians para
-- Gavioes. Entradas de changelog/news ja publicadas (criadas pelo admin)
-- podem conter o termo antigo no texto. Substitui as variacoes nos campos
-- de conteudo. Idempotente: rodar de novo nao causa efeito (termo ja some).

-- ChangelogEntry: title, details (texto) + highlights (array de texto).
UPDATE "ChangelogEntry" SET
  "title"   = REPLACE(REPLACE(REPLACE("title",   'Corinthians', 'Gaviões'), 'corinthians', 'gavioes'), 'Timão', 'Gaviões'),
  "details" = REPLACE(REPLACE(REPLACE("details", 'Corinthians', 'Gaviões'), 'corinthians', 'gavioes'), 'Timão', 'Gaviões')
WHERE "title"   LIKE '%Corinthians%' OR "title"   LIKE '%corinthians%' OR "title"   LIKE '%Timão%'
   OR "details" LIKE '%Corinthians%' OR "details" LIKE '%corinthians%' OR "details" LIKE '%Timão%';

-- highlights eh text[]: remapeia elemento a elemento.
UPDATE "ChangelogEntry" SET "highlights" = (
  SELECT array_agg(
    REPLACE(REPLACE(REPLACE(elem, 'Corinthians', 'Gaviões'), 'corinthians', 'gavioes'), 'Timão', 'Gaviões')
  )
  FROM unnest("highlights") AS elem
)
WHERE EXISTS (
  SELECT 1 FROM unnest("highlights") AS h
  WHERE h LIKE '%Corinthians%' OR h LIKE '%corinthians%' OR h LIKE '%Timão%'
);

-- NewsEntry: title, summary, body (texto).
UPDATE "NewsEntry" SET
  "title"   = REPLACE(REPLACE(REPLACE("title",   'Corinthians', 'Gaviões'), 'corinthians', 'gavioes'), 'Timão', 'Gaviões'),
  "summary" = REPLACE(REPLACE(REPLACE("summary", 'Corinthians', 'Gaviões'), 'corinthians', 'gavioes'), 'Timão', 'Gaviões'),
  "body"    = REPLACE(REPLACE(REPLACE("body",    'Corinthians', 'Gaviões'), 'corinthians', 'gavioes'), 'Timão', 'Gaviões')
WHERE "title"   LIKE '%Corinthians%' OR "title"   LIKE '%corinthians%' OR "title"   LIKE '%Timão%'
   OR "summary" LIKE '%Corinthians%' OR "summary" LIKE '%corinthians%' OR "summary" LIKE '%Timão%'
   OR "body"    LIKE '%Corinthians%' OR "body"    LIKE '%corinthians%' OR "body"    LIKE '%Timão%';
