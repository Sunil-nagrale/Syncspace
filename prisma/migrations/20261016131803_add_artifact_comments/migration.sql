-- CreateTable
CREATE TABLE "comment_thread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "anchorType" TEXT DEFAULT 'GENERAL',
    "anchorData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comment_thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_reaction" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comment_thread_artifactId_isResolved_idx" ON "comment_thread"("artifactId", "isResolved");

-- CreateIndex
CREATE INDEX "comment_thread_workspaceId_idx" ON "comment_thread"("workspaceId");

-- CreateIndex
CREATE INDEX "comment_thread_createdById_idx" ON "comment_thread"("createdById");

-- CreateIndex
CREATE INDEX "comment_threadId_createdAt_idx" ON "comment"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "comment_authorId_idx" ON "comment"("authorId");

-- CreateIndex
CREATE INDEX "comment_reaction_commentId_idx" ON "comment_reaction"("commentId");

-- CreateIndex
CREATE INDEX "comment_reaction_userId_idx" ON "comment_reaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "comment_reaction_commentId_userId_emoji_key" ON "comment_reaction"("commentId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "comment_thread" ADD CONSTRAINT "comment_thread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_thread" ADD CONSTRAINT "comment_thread_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_thread" ADD CONSTRAINT "comment_thread_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_thread" ADD CONSTRAINT "comment_thread_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "comment_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
