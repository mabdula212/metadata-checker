-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'PENDING', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LoginRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceTokenHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "operatingSystem" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "login_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" "LoginRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sessions_deviceId_idx" ON "sessions"("deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "devices_deviceTokenHash_idx" ON "devices"("deviceTokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "devices_status_idx" ON "devices"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "devices_userId_deviceTokenHash_key" ON "devices"("userId", "deviceTokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "login_requests_userId_idx" ON "login_requests"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "login_requests_deviceId_idx" ON "login_requests"("deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "login_requests_status_idx" ON "login_requests"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "login_requests_expiresAt_idx" ON "login_requests"("expiresAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
