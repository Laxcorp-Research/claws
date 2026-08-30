-- INFRA-1: workspace flag for first-boot USER.md interview (no canvas surface).
ALTER TABLE "Workspace" ADD COLUMN "userMdInterviewCompletedAt" TIMESTAMP(3);
