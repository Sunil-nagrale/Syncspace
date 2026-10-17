-- AlterTable: Add optional artifactId relation column to activity_event for efficient artifact-level RBAC enforcement
ALTER TABLE "activity_event" ADD COLUMN "artifactId" TEXT;

-- Backfill artifactId for existing artifact-direct activity events
UPDATE "activity_event" ae
SET "artifactId" = ae."entityId"
FROM "artifact" a
WHERE ae."artifactId" IS NULL
  AND lower(ae."entityType") = 'artifact'
  AND a."id" = ae."entityId";

-- Backfill artifactId for existing child-entity activity events (versions, attachments, comments) that store artifactId in metadata
UPDATE "activity_event" ae
SET "artifactId" = (ae."metadata"->>'artifactId')
FROM "artifact" a
WHERE ae."artifactId" IS NULL
  AND ae."metadata" IS NOT NULL
  AND jsonb_typeof(ae."metadata") = 'object'
  AND (ae."metadata"->>'artifactId') IS NOT NULL
  AND a."id" = (ae."metadata"->>'artifactId');

-- Remove any historical orphaned artifact-scoped activity events whose parent artifact was hard-deleted
DELETE FROM "activity_event"
WHERE "artifactId" IS NULL
  AND lower("entityType") IN ('artifact', 'artifact_version', 'attachment', 'comment_thread', 'comment', 'artifact_permission');

-- CreateIndex
CREATE INDEX "activity_event_workspaceId_createdAt_id_idx" ON "activity_event"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "activity_event_artifactId_idx" ON "activity_event"("artifactId");

-- AddForeignKey
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
