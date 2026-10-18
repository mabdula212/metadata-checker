-- AlterTable
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "processingDuration" INTEGER;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "lastAccessedAt" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "analysisVersion" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_deletedAt_idx" ON "documents"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_userId_createdAt_idx" ON "documents"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_userId_status_idx" ON "documents"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_userId_documentType_idx" ON "documents"("userId", "documentType");
