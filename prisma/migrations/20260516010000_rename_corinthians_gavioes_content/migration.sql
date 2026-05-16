-- Migracao de dados: o tema/avatar foi renomeado para Ninja. Entradas de
-- changelog/news ja publicadas (criadas pelo admin) podem conter termos
-- antigos no texto (Corinthians/Timao/Gavioes). Substitui as variacoes
-- nos campos de conteudo. Idempotente.

-- ChangelogEntry: title, details (texto) + highlights (array de texto).
UPDATE "ChangelogEntry" SET
  "title"   = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("title",   'Corinthians', 'Ninja'), 'corinthians', 'ninja'), 'Timão', 'Ninja'), 'Gaviões', 'Ninja'), 'gavioes', 'ninja'),
  "details" = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("details", 'Corinthians', 'Ninja'), 'corinthians', 'ninja'), 'Timão', 'Ninja'), 'Gaviões', 'Ninja'), 'gavioes', 'ninja')
WHERE "title"   LIKE '%Corinthians%' OR "title"   LIKE '%corinthians%' OR "title"   LIKE '%Timão%' OR "title"   LIKE '%Gaviões%' OR "title"   LIKE '%gavioes%'
   OR "details" LIKE '%Corinthians%' OR "details" LIKE '%corinthians%' OR "details" LIKE '%Timão%' OR "details" LIKE '%Gaviões%' OR "details" LIKE '%gavioes%';

-- highlights eh text[]: remapeia elemento a elemento.
UPDATE "ChangelogEntry" SET "highlights" = (
  SELECT array_agg(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(elem, 'Corinthians', 'Ninja'), 'corinthians', 'ninja'), 'Timão', 'Ninja'), 'Gaviões', 'Ninja'), 'gavioes', 'ninja')
  )
  FROM unnest("highlights") AS elem
)
WHERE EXISTS (
  SELECT 1 FROM unnest("highlights") AS h
  WHERE h LIKE '%Corinthians%' OR h LIKE '%corinthians%' OR h LIKE '%Timão%' OR h LIKE '%Gaviões%' OR h LIKE '%gavioes%'
);

-- NewsEntry: title, summary, body (texto).
UPDATE "NewsEntry" SET
  "title"   = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("title",   'Corinthians', 'Ninja'), 'corinthians', 'ninja'), 'Timão', 'Ninja'), 'Gaviões', 'Ninja'), 'gavioes', 'ninja'),
  "summary" = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("summary", 'Corinthians', 'Ninja'), 'corinthians', 'ninja'), 'Timão', 'Ninja'), 'Gaviões', 'Ninja'), 'gavioes', 'ninja'),
  "body"    = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("body",    'Corinthians', 'Ninja'), 'corinthians', 'ninja'), 'Timão', 'Ninja'), 'Gaviões', 'Ninja'), 'gavioes', 'ninja')
WHERE "title"   LIKE '%Corinthians%' OR "title"   LIKE '%corinthians%' OR "title"   LIKE '%Timão%' OR "title"   LIKE '%Gaviões%' OR "title"   LIKE '%gavioes%'
   OR "summary" LIKE '%Corinthians%' OR "summary" LIKE '%corinthians%' OR "summary" LIKE '%Timão%' OR "summary" LIKE '%Gaviões%' OR "summary" LIKE '%gavioes%'
   OR "body"    LIKE '%Corinthians%' OR "body"    LIKE '%corinthians%' OR "body"    LIKE '%Timão%' OR "body"    LIKE '%Gaviões%' OR "body"    LIKE '%gavioes%';
