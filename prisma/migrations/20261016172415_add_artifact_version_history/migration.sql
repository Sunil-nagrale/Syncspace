-- AlterTable
ALTER TABLE "artifact" ADD COLUMN     "currentRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "currentSnapshot" JSONB;

-- AlterTable
ALTER TABLE "artifact_version" ADD COLUMN     "restoredFromVersion" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'AUTOMATIC';

-- CreateIndex
CREATE INDEX "artifact_version_artifactId_versionNumber_idx" ON "artifact_version"("artifactId", "versionNumber");

-- Data migration: Populate artifact.currentSnapshot from existing artifact_version snapshots
UPDATE "artifact" a
SET "currentSnapshot" = av."snapshotData"
FROM (
  SELECT DISTINCT ON ("artifactId") "artifactId", "snapshotData"
  FROM "artifact_version"
  ORDER BY "artifactId", "versionNumber" DESC
) av
WHERE a."id" = av."artifactId" AND a."currentSnapshot" IS NULL;
