-- AlterTable
ALTER TABLE "datasets" ADD COLUMN     "isShared" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "model_versions" ADD COLUMN     "artifactFormat" TEXT,
ADD COLUMN     "artifactSizeBytes" INTEGER,
ADD COLUMN     "datasetId" UUID,
ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "trainingExperimentId" UUID;

-- CreateIndex
CREATE INDEX "model_versions_datasetId_idx" ON "model_versions"("datasetId");

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_trainingExperimentId_fkey" FOREIGN KEY ("trainingExperimentId") REFERENCES "experiments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
