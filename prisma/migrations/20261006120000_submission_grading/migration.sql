-- AlterTable
ALTER TABLE "submissions" ADD COLUMN "late" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rubricScores" JSONB;
