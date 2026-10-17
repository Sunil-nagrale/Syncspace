-- Enable trigram extension for indexed substring and fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable: Add indexed plain-text search column to artifact
ALTER TABLE "artifact" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

-- Helper function to extract searchable text from Tiptap document JSON or Excalidraw whiteboard JSON
CREATE OR REPLACE FUNCTION syncspace_extract_artifact_search_text(
  artifact_type "ArtifactType",
  snapshot JSONB
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  extracted TEXT;
BEGIN
  IF snapshot IS NULL OR jsonb_typeof(snapshot) <> 'object' THEN
    RETURN '';
  END IF;

  IF artifact_type = 'DOCUMENT' THEN
    SELECT coalesce(string_agg(elem_text, ' '), '')
    INTO extracted
    FROM jsonb_array_elements_text(
      jsonb_path_query_array(snapshot, '$.**.text ? (@.type() == "string")')
    ) AS elem_text;
  ELSIF artifact_type = 'WHITEBOARD' THEN
    SELECT coalesce(string_agg(elem_text, ' '), '')
    INTO extracted
    FROM jsonb_array_elements_text(
      jsonb_path_query_array(snapshot, '$.elements[*] ? (@.isDeleted != true).text ? (@.type() == "string")')
    ) AS elem_text;
  ELSE
    extracted := '';
  END IF;

  RETURN left(regexp_replace(coalesce(extracted, ''), '\s+', ' ', 'g'), 200000);
EXCEPTION
  WHEN OTHERS THEN
    RETURN '';
END;
$$;

-- Trigger function to keep artifact.searchText synchronized whenever currentSnapshot changes
CREATE OR REPLACE FUNCTION syncspace_artifact_search_text_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."currentSnapshot" IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD."currentSnapshot" IS NOT NULL AND NEW."searchText" IS NOT DISTINCT FROM OLD."searchText" THEN
      NEW."searchText" := '';
    ELSIF NEW."searchText" IS NULL THEN
      NEW."searchText" := '';
    END IF;
  ELSIF (
    NEW."searchText" IS NULL
    OR NEW."searchText" = ''
    OR (
      TG_OP = 'UPDATE'
      AND NEW."currentSnapshot" IS DISTINCT FROM OLD."currentSnapshot"
      AND NEW."searchText" IS NOT DISTINCT FROM OLD."searchText"
    )
  ) THEN
    NEW."searchText" := syncspace_extract_artifact_search_text(NEW."type", NEW."currentSnapshot");
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS artifact_sync_search_text_trg ON "artifact";
CREATE TRIGGER artifact_sync_search_text_trg
BEFORE INSERT OR UPDATE OF "type", "currentSnapshot", "searchText"
ON "artifact"
FOR EACH ROW
EXECUTE FUNCTION syncspace_artifact_search_text_trigger();

-- Backfill searchText for existing artifacts
UPDATE "artifact"
SET "searchText" = syncspace_extract_artifact_search_text("type", "currentSnapshot")
WHERE "currentSnapshot" IS NOT NULL AND ("searchText" IS NULL OR "searchText" = '');

-- PostgreSQL GIN Full-Text Search (tsvector) indexes on artifact
CREATE INDEX "artifact_fts_en_idx" ON "artifact" USING GIN (
  (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("searchText", '')), 'C')
  )
);

CREATE INDEX "artifact_fts_simple_idx" ON "artifact" USING GIN (
  (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("searchText", '')), 'C')
  )
);

-- PostgreSQL GIN Trigram (pg_trgm) indexes on artifact for substring and fuzzy matching
CREATE INDEX "artifact_title_trgm_idx" ON "artifact" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "artifact_search_text_trgm_idx" ON "artifact" USING GIN ("searchText" gin_trgm_ops);

-- PostgreSQL GIN Full-Text Search (tsvector) and Trigram indexes on project
CREATE INDEX "project_fts_en_idx" ON "project" USING GIN (
  (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
  )
);

CREATE INDEX "project_fts_simple_idx" ON "project" USING GIN (
  (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B')
  )
);

CREATE INDEX "project_name_trgm_idx" ON "project" USING GIN ("name" gin_trgm_ops);
