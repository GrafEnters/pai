-- CreateEnum
CREATE TYPE "Role" AS ENUM ('NONE', 'VIEWER', 'EDITOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('BUYER', 'FARMER', 'TECH', 'MEDIABUYER', 'MANAGER', 'OTHER');

-- CreateEnum
CREATE TYPE "GuideStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GuideLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'FILE');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('PAGE_VIEW', 'GUIDE_OPEN', 'GUIDE_SCROLL', 'GUIDE_HEARTBEAT', 'GUIDE_READ', 'VIDEO_PLAY', 'VIDEO_PROGRESS', 'VIDEO_COMPLETE', 'VIDEO_SEEK', 'SEARCH', 'SEARCH_EMPTY', 'LINK_CLICK', 'FILE_DOWNLOAD', 'FEEDBACK', 'CHECKLIST_TOGGLE');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('DB', 'CONTENT', 'MEDIA', 'FULL');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT,
    "telegramUsername" TEXT,
    "login" TEXT,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'NONE',
    "teamRole" "TeamRole" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "teamRole" "TeamRole" NOT NULL DEFAULT 'OTHER',
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "usedById" INTEGER,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLink" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "parentId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guide" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "coverId" INTEGER,
    "categoryId" INTEGER NOT NULL,
    "status" "GuideStatus" NOT NULL DEFAULT 'DRAFT',
    "level" "GuideLevel" NOT NULL DEFAULT 'BEGINNER',
    "content" JSONB NOT NULL,
    "contentDraft" JSONB,
    "html" TEXT,
    "plainText" TEXT,
    "readingTimeSec" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "authorId" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiredForRoles" "TeamRole"[] DEFAULT ARRAY[]::"TeamRole"[],
    "reviewAt" TIMESTAMP(3),
    "lockedById" INTEGER,
    "lockedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuideVersion" (
    "id" SERIAL NOT NULL,
    "guideId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "changedById" INTEGER NOT NULL,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuideVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuideTag" (
    "guideId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "GuideTag_pkey" PRIMARY KEY ("guideId","tagId")
);

-- CreateTable
CREATE TABLE "GuideRelation" (
    "fromId" INTEGER NOT NULL,
    "toId" INTEGER NOT NULL,

    CONSTRAINT "GuideRelation_pkey" PRIMARY KEY ("fromId","toId")
);

-- CreateTable
CREATE TABLE "GuideMedia" (
    "guideId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,

    CONSTRAINT "GuideMedia_pkey" PRIMARY KEY ("guideId","mediaId")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" SERIAL NOT NULL,
    "type" "MediaType" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "blurhash" TEXT,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "posterKey" TEXT,
    "alt" TEXT,
    "title" TEXT,
    "uploadedById" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" BIGSERIAL NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "EventType" NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" INTEGER,
    "guideId" INTEGER,
    "mediaId" INTEGER,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "country" TEXT,
    "device" TEXT,
    "props" JSONB NOT NULL DEFAULT '{}',
    "dedupKey" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyGuideStat" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "guideId" INTEGER NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "reads" INTEGER NOT NULL DEFAULT 0,
    "avgActiveSec" INTEGER NOT NULL DEFAULT 0,
    "scroll50" INTEGER NOT NULL DEFAULT 0,
    "scroll100" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyGuideStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyVideoStat" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "uniqueViewers" INTEGER NOT NULL DEFAULT 0,
    "p25" INTEGER NOT NULL DEFAULT 0,
    "p50" INTEGER NOT NULL DEFAULT 0,
    "p75" INTEGER NOT NULL DEFAULT 0,
    "p95" INTEGER NOT NULL DEFAULT 0,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "avgWatchSec" INTEGER NOT NULL DEFAULT 0,
    "bytesServed" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "DailyVideoStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" SERIAL NOT NULL,
    "q" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "userId" INTEGER,
    "clickedGuideId" INTEGER,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuideFeedback" (
    "id" SERIAL NOT NULL,
    "guideId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "comment" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuideFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGuideProgress" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "guideId" INTEGER NOT NULL,
    "firstOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "activeSec" INTEGER NOT NULL DEFAULT 0,
    "checklistState" JSONB NOT NULL DEFAULT '{}',
    "videoPositions" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "UserGuideProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" SERIAL NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "filesUploaded" INTEGER NOT NULL DEFAULT 0,
    "filesSkipped" INTEGER NOT NULL DEFAULT 0,
    "bytesUploaded" BIGINT NOT NULL DEFAULT 0,
    "driveFolderId" TEXT,
    "manifestKey" TEXT,
    "error" TEXT,
    "log" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupObject" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveMd5" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BackupObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "diff" JSONB,
    "ip" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUsername_key" ON "User"("telegramUsername");

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginLink_tokenHash_key" ON "LoginLink"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginLink_userId_idx" ON "LoginLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Guide_slug_key" ON "Guide"("slug");

-- CreateIndex
CREATE INDEX "Guide_status_categoryId_idx" ON "Guide"("status", "categoryId");

-- CreateIndex
CREATE INDEX "Guide_publishedAt_idx" ON "Guide"("publishedAt");

-- CreateIndex
CREATE INDEX "Guide_reviewAt_idx" ON "Guide"("reviewAt");

-- CreateIndex
CREATE INDEX "GuideVersion_guideId_idx" ON "GuideVersion"("guideId");

-- CreateIndex
CREATE UNIQUE INDEX "GuideVersion_guideId_version_key" ON "GuideVersion"("guideId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Media_key_key" ON "Media"("key");

-- CreateIndex
CREATE INDEX "Media_sha256_idx" ON "Media"("sha256");

-- CreateIndex
CREATE INDEX "Media_type_status_idx" ON "Media"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Event_dedupKey_key" ON "Event"("dedupKey");

-- CreateIndex
CREATE INDEX "Event_ts_idx" ON "Event"("ts");

-- CreateIndex
CREATE INDEX "Event_guideId_ts_idx" ON "Event"("guideId", "ts");

-- CreateIndex
CREATE INDEX "Event_userId_ts_idx" ON "Event"("userId", "ts");

-- CreateIndex
CREATE INDEX "Event_type_ts_idx" ON "Event"("type", "ts");

-- CreateIndex
CREATE INDEX "DailyGuideStat_date_idx" ON "DailyGuideStat"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyGuideStat_date_guideId_key" ON "DailyGuideStat"("date", "guideId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyVideoStat_date_mediaId_key" ON "DailyVideoStat"("date", "mediaId");

-- CreateIndex
CREATE INDEX "SearchQuery_ts_idx" ON "SearchQuery"("ts");

-- CreateIndex
CREATE UNIQUE INDEX "GuideFeedback_guideId_userId_key" ON "GuideFeedback"("guideId", "userId");

-- CreateIndex
CREATE INDEX "UserGuideProgress_userId_idx" ON "UserGuideProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserGuideProgress_userId_guideId_key" ON "UserGuideProgress"("userId", "guideId");

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackupObject_key_key" ON "BackupObject"("key");

-- CreateIndex
CREATE INDEX "BackupObject_syncedAt_idx" ON "BackupObject"("syncedAt");

-- CreateIndex
CREATE INDEX "BackupObject_deletedAt_idx" ON "BackupObject"("deletedAt");

-- CreateIndex
CREATE INDEX "AuditLog_ts_idx" ON "AuditLog"("ts");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginLink" ADD CONSTRAINT "LoginLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideVersion" ADD CONSTRAINT "GuideVersion_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideVersion" ADD CONSTRAINT "GuideVersion_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideTag" ADD CONSTRAINT "GuideTag_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideTag" ADD CONSTRAINT "GuideTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideRelation" ADD CONSTRAINT "GuideRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideRelation" ADD CONSTRAINT "GuideRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideMedia" ADD CONSTRAINT "GuideMedia_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideMedia" ADD CONSTRAINT "GuideMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideFeedback" ADD CONSTRAINT "GuideFeedback_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideFeedback" ADD CONSTRAINT "GuideFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGuideProgress" ADD CONSTRAINT "UserGuideProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGuideProgress" ADD CONSTRAINT "UserGuideProgress_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
