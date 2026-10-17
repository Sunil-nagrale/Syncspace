-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETING');

-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve any pre-existing attachment rows as READY
UPDATE "attachment" SET "status" = 'READY';

-- CreateIndex
CREATE UNIQUE INDEX "attachment_storageKey_key" ON "attachment"("storageKey");

-- CreateIndex
CREATE INDEX "attachment_artifactId_status_createdAt_idx" ON "attachment"("artifactId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "attachment_uploadedById_status_idx" ON "attachment"("uploadedById", "status");
