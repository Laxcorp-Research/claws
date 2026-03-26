/*
  Warnings:

  - You are about to drop the column `review` on the `TemplateReview` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `TemplateReview` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('UNREVIEWED', 'SCANNED', 'VERIFIED', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'RELEASABLE', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('MALICIOUS', 'MISLEADING', 'COPYRIGHT', 'SPAM', 'INAPPROPRIATE', 'BROKEN', 'NAME_CONFLICT');

-- AlterTable
ALTER TABLE "ClawTemplate" ADD COLUMN     "creatorId" TEXT,
ADD COLUMN     "estimatedMonthlyCost" TEXT,
ADD COLUMN     "installCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isFree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minOpenClawVersion" TEXT,
ADD COLUMN     "reviewNotes" TEXT,
ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "testedOnVersion" TEXT,
ADD COLUMN     "trustTier" "TrustTier" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "TemplateReview" DROP COLUMN "review",
ADD COLUMN     "body" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "verifiedInstall" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialStartedAt" TIMESTAMP(3),
ADD COLUMN     "trialUsed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TemplateInstall" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "websiteUrl" TEXT,
    "twitterUrl" TEXT,
    "githubUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "agreedToTermsAt" TIMESTAMP(3) NOT NULL,
    "dodoBeneficiaryId" TEXT,
    "totalInstalls" INTEGER NOT NULL DEFAULT 0,
    "totalTemplates" INTEGER NOT NULL DEFAULT 0,
    "totalSkills" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceSkill" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "emoji" TEXT,
    "skillMd" TEXT NOT NULL,
    "requiredBins" TEXT[],
    "requiredEnvVars" TEXT[],
    "creatorId" TEXT,
    "trustTier" "TrustTier" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "autoScanPassed" BOOLEAN,
    "autoScanReport" TEXT,
    "sandboxPassed" BOOLEAN,
    "sandboxReport" TEXT,
    "isFree" BOOLEAN NOT NULL DEFAULT true,
    "price" DOUBLE PRECISION,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "avgRating" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "minOpenClawVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillReview" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "verifiedInstall" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillInstall" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceSale" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "skillId" TEXT,
    "buyerId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "processingFee" DOUBLE PRECISION NOT NULL,
    "creatorPayout" DOUBLE PRECISION NOT NULL,
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "payoutHeldUntil" TIMESTAMP(3),
    "payoutBatchId" TEXT,
    "paidAt" TIMESTAMP(3),
    "dodoPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "templateId" TEXT,
    "skillId" TEXT,
    "reviewId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenClawVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isStable" BOOLEAN NOT NULL DEFAULT false,
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "isSecurityPatch" BOOLEAN NOT NULL DEFAULT false,
    "dockerImage" TEXT NOT NULL,
    "releaseNotes" TEXT,
    "breakingChanges" TEXT,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "stableAt" TIMESTAMP(3),
    "testedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenClawVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateInstall_templateId_idx" ON "TemplateInstall"("templateId");

-- CreateIndex
CREATE INDEX "TemplateInstall_createdAt_idx" ON "TemplateInstall"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateInstall_templateId_userId_key" ON "TemplateInstall"("templateId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceSkill_slug_key" ON "MarketplaceSkill"("slug");

-- CreateIndex
CREATE INDEX "MarketplaceSkill_category_idx" ON "MarketplaceSkill"("category");

-- CreateIndex
CREATE INDEX "MarketplaceSkill_trustTier_idx" ON "MarketplaceSkill"("trustTier");

-- CreateIndex
CREATE INDEX "MarketplaceSkill_isPublished_idx" ON "MarketplaceSkill"("isPublished");

-- CreateIndex
CREATE INDEX "MarketplaceSkill_creatorId_idx" ON "MarketplaceSkill"("creatorId");

-- CreateIndex
CREATE INDEX "MarketplaceSkill_installCount_idx" ON "MarketplaceSkill"("installCount");

-- CreateIndex
CREATE INDEX "SkillReview_skillId_idx" ON "SkillReview"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillReview_skillId_userId_key" ON "SkillReview"("skillId", "userId");

-- CreateIndex
CREATE INDEX "SkillInstall_skillId_idx" ON "SkillInstall"("skillId");

-- CreateIndex
CREATE INDEX "SkillInstall_createdAt_idx" ON "SkillInstall"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SkillInstall_skillId_userId_key" ON "SkillInstall"("skillId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceSale_dodoPaymentId_key" ON "MarketplaceSale"("dodoPaymentId");

-- CreateIndex
CREATE INDEX "MarketplaceSale_creatorId_idx" ON "MarketplaceSale"("creatorId");

-- CreateIndex
CREATE INDEX "MarketplaceSale_payoutStatus_idx" ON "MarketplaceSale"("payoutStatus");

-- CreateIndex
CREATE INDEX "MarketplaceSale_createdAt_idx" ON "MarketplaceSale"("createdAt");

-- CreateIndex
CREATE INDEX "Report_resolved_idx" ON "Report"("resolved");

-- CreateIndex
CREATE UNIQUE INDEX "OpenClawVersion_version_key" ON "OpenClawVersion"("version");

-- CreateIndex
CREATE INDEX "ClawTemplate_trustTier_idx" ON "ClawTemplate"("trustTier");

-- CreateIndex
CREATE INDEX "ClawTemplate_isPublished_idx" ON "ClawTemplate"("isPublished");

-- CreateIndex
CREATE INDEX "ClawTemplate_creatorId_idx" ON "ClawTemplate"("creatorId");

-- CreateIndex
CREATE INDEX "ClawTemplate_installCount_idx" ON "ClawTemplate"("installCount");

-- AddForeignKey
ALTER TABLE "ClawTemplate" ADD CONSTRAINT "ClawTemplate_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateReview" ADD CONSTRAINT "TemplateReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInstall" ADD CONSTRAINT "TemplateInstall_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClawTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInstall" ADD CONSTRAINT "TemplateInstall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceSkill" ADD CONSTRAINT "MarketplaceSkill_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillReview" ADD CONSTRAINT "SkillReview_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "MarketplaceSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillReview" ADD CONSTRAINT "SkillReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillInstall" ADD CONSTRAINT "SkillInstall_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "MarketplaceSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillInstall" ADD CONSTRAINT "SkillInstall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceSale" ADD CONSTRAINT "MarketplaceSale_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClawTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceSale" ADD CONSTRAINT "MarketplaceSale_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "MarketplaceSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceSale" ADD CONSTRAINT "MarketplaceSale_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
