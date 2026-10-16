-- CreateEnum
CREATE TYPE "CommentThreadEventType" AS ENUM ('RESOLVED', 'REOPENED');

-- DropIndex
DROP INDEX "comment_thread_artifactId_isResolved_idx";

-- CreateTable
CREATE TABLE "comment_thread_event" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CommentThreadEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_thread_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comment_thread_event_threadId_createdAt_idx" ON "comment_thread_event"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "comment_thread_event_artifactId_createdAt_idx" ON "comment_thread_event"("artifactId", "createdAt");

-- CreateIndex
CREATE INDEX "comment_thread_event_workspaceId_idx" ON "comment_thread_event"("workspaceId");

-- CreateIndex
CREATE INDEX "comment_thread_event_userId_idx" ON "comment_thread_event"("userId");

-- CreateIndex
CREATE INDEX "comment_thread_artifactId_isResolved_createdAt_idx" ON "comment_thread"("artifactId", "isResolved", "createdAt");

-- AddForeignKey
ALTER TABLE "comment_thread_event" ADD CONSTRAINT "comment_thread_event_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "comment_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_thread_event" ADD CONSTRAINT "comment_thread_event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_thread_event" ADD CONSTRAINT "comment_thread_event_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_thread_event" ADD CONSTRAINT "comment_thread_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
