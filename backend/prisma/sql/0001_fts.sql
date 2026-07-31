-- Полнотекстовый поиск по гайдам (PLAN §5.4).
-- Патч идемпотентный: применяется при каждом старте backend и в seed.
-- Почему не в schema.prisma — см. DECISIONS.md §5.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Генерируемая колонка: пересчитывается самим Postgres при любом UPDATE строки,
-- поэтому её невозможно «забыть обновить» из кода.
ALTER TABLE "Guide"
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('russian', coalesce("plainText", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS guide_tsv_idx ON "Guide" USING GIN (tsv);

-- Триграммный индекс по заголовку — подсказки и терпимость к опечаткам
CREATE INDEX IF NOT EXISTS guide_title_trgm_idx ON "Guide" USING GIN (title gin_trgm_ops);
