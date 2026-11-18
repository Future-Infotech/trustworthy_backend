-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `name` ENUM('SUPER_ADMIN', 'ADMIN', 'FACULTY', 'STUDENT', 'DEVELOPER', 'PRODUCT_DEVELOPER', 'EXECUTIVE') NOT NULL,
    `displayName` TEXT NOT NULL,
    `description` TEXT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(255) NOT NULL,
    `resource` VARCHAR(255) NOT NULL,
    `action` TEXT NOT NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_key_key`(`key`),
    INDEX `permissions_resource_idx`(`resource`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` CHAR(36) NOT NULL,
    `permissionId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_permissions_permissionId_idx`(`permissionId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `passwordHash` TEXT NOT NULL,
    `firstName` TEXT NOT NULL,
    `lastName` TEXT NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'INVITED', 'SUSPENDED', 'PENDING_DELETION', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `organization` TEXT NULL,
    `jobTitle` TEXT NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_roleId_idx`(`roleId`),
    INDEX `users_status_idx`(`status`),
    INDEX `users_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(255) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` TEXT NULL,
    `replacedByTokenId` CHAR(36) NULL,
    `createdByIp` TEXT NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_familyId_idx`(`familyId`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consent_records` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `consentType` VARCHAR(255) NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `policyVersion` TEXT NOT NULL,
    `ipAddress` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `consent_records_userId_consentType_idx`(`userId`, `consentType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_deletion_requests` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
    `reason` TEXT NULL,
    `notes` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `processedById` CHAR(36) NULL,

    INDEX `data_deletion_requests_userId_idx`(`userId`),
    INDEX `data_deletion_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courses` (
    `id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `slug` VARCHAR(255) NOT NULL,
    `summary` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `coverImageUrl` TEXT NULL,
    `level` VARCHAR(255) NOT NULL DEFAULT 'Intermediate',
    `durationHours` INTEGER NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `instructorId` CHAR(36) NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    UNIQUE INDEX `courses_slug_key`(`slug`),
    INDEX `courses_status_idx`(`status`),
    INDEX `courses_instructorId_idx`(`instructorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `modules` (
    `id` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `summary` TEXT NOT NULL,
    `order` INTEGER NOT NULL,
    `objectives` JSON NOT NULL,
    `estimatedMinutes` INTEGER NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    UNIQUE INDEX `modules_courseId_order_key`(`courseId`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lessons` (
    `id` CHAR(36) NOT NULL,
    `moduleId` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `type` ENUM('TEXT', 'VIDEO', 'IMAGE', 'CODE', 'KNOWLEDGE_CHECK', 'EXERCISE') NOT NULL DEFAULT 'TEXT',
    `content` TEXT NOT NULL,
    `media` JSON NULL,
    `codeSnippet` TEXT NULL,
    `codeLanguage` TEXT NULL,
    `videoUrl` TEXT NULL,
    `knowledgeCheck` JSON NULL,
    `order` INTEGER NOT NULL,
    `estimatedMinutes` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    UNIQUE INDEX `lessons_moduleId_order_key`(`moduleId`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enrollments` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'COMPLETED', 'DROPPED') NOT NULL DEFAULT 'ACTIVE',
    `progressPercent` DOUBLE NOT NULL DEFAULT 0,
    `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `enrollments_courseId_status_idx`(`courseId`, `status`),
    UNIQUE INDEX `enrollments_userId_courseId_key`(`userId`, `courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `progress` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `lessonId` CHAR(36) NOT NULL,
    `moduleId` CHAR(36) NOT NULL,
    `status` ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'NOT_STARTED',
    `timeSpentSeconds` INTEGER NOT NULL DEFAULT 0,
    `lastAccessedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `progress_userId_moduleId_idx`(`userId`, `moduleId`),
    UNIQUE INDEX `progress_userId_lessonId_key`(`userId`, `lessonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `labs` (
    `id` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NULL,
    `moduleId` CHAR(36) NULL,
    `slug` VARCHAR(255) NOT NULL,
    `title` TEXT NOT NULL,
    `type` ENUM('XAI', 'FAIRNESS', 'ROBUSTNESS', 'MODEL_CARD', 'RISK_ASSESSMENT', 'GOVERNANCE') NOT NULL,
    `description` TEXT NOT NULL,
    `instructions` TEXT NOT NULL,
    `config` JSON NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT false,
    `estimatedMinutes` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    UNIQUE INDEX `labs_slug_key`(`slug`),
    INDEX `labs_type_idx`(`type`),
    INDEX `labs_moduleId_idx`(`moduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lab_attempts` (
    `id` CHAR(36) NOT NULL,
    `labId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `experimentId` CHAR(36) NULL,
    `status` ENUM('IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'IN_PROGRESS',
    `score` DOUBLE NULL,
    `notes` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lab_attempts_userId_status_idx`(`userId`, `status`),
    INDEX `lab_attempts_labId_idx`(`labId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignments` (
    `id` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `moduleId` CHAR(36) NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `instructions` TEXT NOT NULL,
    `targetRoles` JSON NOT NULL,
    `dueDate` DATETIME(3) NULL,
    `maxScore` INTEGER NOT NULL DEFAULT 100,
    `rubric` JSON NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `assignments_courseId_idx`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `submissions` (
    `id` CHAR(36) NOT NULL,
    `assignmentId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `attemptNumber` INTEGER NOT NULL DEFAULT 1,
    `content` TEXT NOT NULL,
    `attachments` JSON NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'GRADED', 'RETURNED') NOT NULL DEFAULT 'SUBMITTED',
    `late` BOOLEAN NOT NULL DEFAULT false,
    `score` DOUBLE NULL,
    `rubricScores` JSON NULL,
    `feedback` TEXT NULL,
    `gradedById` CHAR(36) NULL,
    `gradedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `submissions_userId_idx`(`userId`),
    INDEX `submissions_status_idx`(`status`),
    UNIQUE INDEX `submissions_assignmentId_userId_attemptNumber_key`(`assignmentId`, `userId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quizzes` (
    `id` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NULL,
    `moduleId` CHAR(36) NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NULL,
    `passingScore` INTEGER NOT NULL DEFAULT 70,
    `timeLimitSeconds` INTEGER NULL,
    `attemptLimit` INTEGER NULL,
    `randomizeQuestions` BOOLEAN NOT NULL DEFAULT true,
    `questionsPerAttempt` INTEGER NULL,
    `isFinal` BOOLEAN NOT NULL DEFAULT false,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `quizzes_courseId_idx`(`courseId`),
    INDEX `quizzes_moduleId_idx`(`moduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `questions` (
    `id` CHAR(36) NOT NULL,
    `quizId` CHAR(36) NULL,
    `bankCategory` VARCHAR(255) NULL,
    `type` ENUM('MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SCENARIO') NOT NULL,
    `prompt` TEXT NOT NULL,
    `scenario` TEXT NULL,
    `options` JSON NOT NULL,
    `correctOptionIds` JSON NOT NULL,
    `explanation` TEXT NOT NULL,
    `points` INTEGER NOT NULL DEFAULT 1,
    `difficulty` VARCHAR(255) NOT NULL DEFAULT 'MEDIUM',
    `tags` JSON NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `questions_quizId_idx`(`quizId`),
    INDEX `questions_bankCategory_idx`(`bankCategory`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_attempts` (
    `id` CHAR(36) NOT NULL,
    `quizId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `questionIds` JSON NOT NULL,
    `answers` JSON NULL,
    `score` DOUBLE NULL,
    `maxScore` DOUBLE NULL,
    `percentage` DOUBLE NULL,
    `passed` BOOLEAN NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,

    INDEX `quiz_attempts_userId_idx`(`userId`),
    UNIQUE INDEX `quiz_attempts_quizId_userId_attemptNumber_key`(`quizId`, `userId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certificates` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `certificateNumber` VARCHAR(255) NOT NULL,
    `verificationCode` VARCHAR(255) NOT NULL,
    `status` ENUM('PENDING_APPROVAL', 'ISSUED', 'REVOKED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `completionDate` DATETIME(3) NULL,
    `issuedAt` DATETIME(3) NULL,
    `approvedById` CHAR(36) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `certificates_certificateNumber_key`(`certificateNumber`),
    UNIQUE INDEX `certificates_verificationCode_key`(`verificationCode`),
    INDEX `certificates_status_idx`(`status`),
    UNIQUE INDEX `certificates_userId_courseId_key`(`userId`, `courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `datasets` (
    `id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `fileName` TEXT NOT NULL,
    `mimeType` VARCHAR(255) NOT NULL DEFAULT 'text/csv',
    `storageKey` TEXT NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `checksumSha256` TEXT NOT NULL,
    `rowCount` INTEGER NULL,
    `columnCount` INTEGER NULL,
    `duplicateRowCount` INTEGER NULL,
    `missingCellCount` INTEGER NULL,
    `status` ENUM('UPLOADED', 'PROCESSING', 'READY', 'INVALID', 'DELETED') NOT NULL DEFAULT 'UPLOADED',
    `validationErrors` JSON NULL,
    `targetColumn` TEXT NULL,
    `sensitiveColumns` JSON NOT NULL,
    `profile` JSON NULL,
    `isSynthetic` BOOLEAN NOT NULL DEFAULT false,
    `containsPersonalData` BOOLEAN NOT NULL DEFAULT false,
    `isShared` BOOLEAN NOT NULL DEFAULT false,
    `retentionUntil` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `datasets_ownerId_idx`(`ownerId`),
    INDEX `datasets_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dataset_columns` (
    `id` CHAR(36) NOT NULL,
    `datasetId` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `position` INTEGER NOT NULL,
    `dataType` ENUM('NUMERIC', 'CATEGORICAL', 'BOOLEAN', 'DATETIME', 'TEXT') NOT NULL,
    `isSensitive` BOOLEAN NOT NULL DEFAULT false,
    `isTarget` BOOLEAN NOT NULL DEFAULT false,
    `missingCount` INTEGER NOT NULL DEFAULT 0,
    `uniqueCount` INTEGER NULL,
    `stats` JSON NULL,

    UNIQUE INDEX `dataset_columns_datasetId_name_key`(`datasetId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_models` (
    `id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `purpose` TEXT NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `aiSystemId` CHAR(36) NULL,
    `framework` TEXT NOT NULL,
    `algorithm` TEXT NOT NULL,
    `trainingDatasetId` CHAR(36) NULL,
    `riskLevel` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NULL,
    `fairnessStatus` ENUM('NOT_ASSESSED', 'PASSED', 'WARNING', 'FAILED') NOT NULL DEFAULT 'NOT_ASSESSED',
    `securityStatus` ENUM('NOT_ASSESSED', 'PASSED', 'WARNING', 'FAILED') NOT NULL DEFAULT 'NOT_ASSESSED',
    `explainabilityStatus` ENUM('NOT_ASSESSED', 'PASSED', 'WARNING', 'FAILED') NOT NULL DEFAULT 'NOT_ASSESSED',
    `lifecycleStage` ENUM('DEVELOPMENT', 'TESTING', 'REVIEW', 'APPROVED', 'PRODUCTION', 'SUSPENDED', 'RETIRED') NOT NULL DEFAULT 'DEVELOPMENT',
    `nextReviewAt` DATETIME(3) NULL,
    `tags` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `ai_models_ownerId_idx`(`ownerId`),
    INDEX `ai_models_lifecycleStage_idx`(`lifecycleStage`),
    INDEX `ai_models_riskLevel_idx`(`riskLevel`),
    INDEX `ai_models_aiSystemId_idx`(`aiSystemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_versions` (
    `id` CHAR(36) NOT NULL,
    `modelId` CHAR(36) NOT NULL,
    `version` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `artifactKey` TEXT NULL,
    `artifactChecksum` TEXT NULL,
    `artifactFormat` TEXT NULL,
    `artifactSizeBytes` INTEGER NULL,
    `metrics` JSON NULL,
    `parameters` JSON NULL,
    `featureColumns` JSON NOT NULL,
    `targetColumn` TEXT NULL,
    `randomSeed` INTEGER NULL,
    `datasetId` CHAR(36) NULL,
    `fingerprint` TEXT NULL,
    `trainingExperimentId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,

    INDEX `model_versions_datasetId_idx`(`datasetId`),
    UNIQUE INDEX `model_versions_modelId_version_key`(`modelId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experiments` (
    `id` CHAR(36) NOT NULL,
    `name` TEXT NULL,
    `type` ENUM('DATASET_ANALYSIS', 'TRAINING', 'SHAP', 'LIME', 'COUNTERFACTUAL', 'GRAD_CAM', 'FAIRNESS_AUDIT', 'FAIRNESS_MITIGATION', 'FGSM', 'PGD', 'ADVERSARIAL_TRAINING') NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `userId` CHAR(36) NOT NULL,
    `datasetId` CHAR(36) NULL,
    `modelVersionId` CHAR(36) NULL,
    `algorithm` TEXT NULL,
    `parameters` JSON NOT NULL,
    `randomSeed` INTEGER NOT NULL,
    `configHash` TEXT NOT NULL,
    `jobId` TEXT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `logs` JSON NULL,
    `error` TEXT NULL,
    `isEducational` BOOLEAN NOT NULL DEFAULT true,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `experiments_userId_type_idx`(`userId`, `type`),
    INDEX `experiments_status_idx`(`status`),
    INDEX `experiments_datasetId_idx`(`datasetId`),
    INDEX `experiments_modelVersionId_idx`(`modelVersionId`),
    INDEX `experiments_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experiment_results` (
    `id` CHAR(36) NOT NULL,
    `experimentId` CHAR(36) NOT NULL,
    `kind` VARCHAR(255) NOT NULL,
    `metrics` JSON NULL,
    `data` JSON NOT NULL,
    `plots` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `experiment_results_experimentId_kind_idx`(`experimentId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_cards` (
    `id` CHAR(36) NOT NULL,
    `modelId` CHAR(36) NULL,
    `name` TEXT NOT NULL,
    `version` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `content` JSON NOT NULL,
    `parentCardId` CHAR(36) NULL,
    `ownerId` CHAR(36) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `publishedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `model_cards_modelId_idx`(`modelId`),
    INDEX `model_cards_status_idx`(`status`),
    INDEX `model_cards_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_assessments` (
    `id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `aiSystemId` CHAR(36) NULL,
    `modelId` CHAR(36) NULL,
    `assessorId` CHAR(36) NOT NULL,
    `answers` JSON NOT NULL,
    `score` INTEGER NULL,
    `riskLevel` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NULL,
    `riskFactors` JSON NULL,
    `recommendedControls` JSON NULL,
    `requiredOversight` TEXT NULL,
    `complianceConsiderations` JSON NULL,
    `scoringVersion` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `reviewerId` CHAR(36) NULL,
    `reviewComment` TEXT NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `risk_assessments_status_idx`(`status`),
    INDEX `risk_assessments_riskLevel_idx`(`riskLevel`),
    INDEX `risk_assessments_aiSystemId_idx`(`aiSystemId`),
    INDEX `risk_assessments_modelId_idx`(`modelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `algorithmic_impact_assessments` (
    `id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `aiSystemId` CHAR(36) NULL,
    `ownerId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `sections` JSON NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedById` CHAR(36) NULL,
    `retiredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `algorithmic_impact_assessments_status_idx`(`status`),
    INDEX `algorithmic_impact_assessments_aiSystemId_idx`(`aiSystemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aia_status_history` (
    `id` CHAR(36) NOT NULL,
    `assessmentId` CHAR(36) NOT NULL,
    `fromStatus` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'RETIRED') NULL,
    `toStatus` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'RETIRED') NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `comment` TEXT NULL,
    `snapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `aia_status_history_assessmentId_createdAt_idx`(`assessmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_systems` (
    `id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `businessUnit` TEXT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `status` ENUM('PROPOSED', 'DEVELOPMENT', 'ACTIVE', 'SUSPENDED', 'RETIRED') NOT NULL DEFAULT 'PROPOSED',
    `riskLevel` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NULL,
    `isThirdParty` BOOLEAN NOT NULL DEFAULT false,
    `vendorName` TEXT NULL,
    `isShadowAI` BOOLEAN NOT NULL DEFAULT false,
    `discoveredVia` TEXT NULL,
    `dataCategories` JSON NOT NULL,
    `lastReviewedAt` DATETIME(3) NULL,
    `nextReviewAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `ai_systems_status_idx`(`status`),
    INDEX `ai_systems_riskLevel_idx`(`riskLevel`),
    INDEX `ai_systems_isShadowAI_idx`(`isShadowAI`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `governance_policies` (
    `id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `slug` VARCHAR(255) NOT NULL,
    `category` VARCHAR(255) NOT NULL,
    `summary` TEXT NOT NULL,
    `content` TEXT NOT NULL,
    `version` VARCHAR(255) NOT NULL DEFAULT '1.0',
    `status` ENUM('DRAFT', 'UNDER_REVIEW', 'ACTIVE', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `effectiveDate` DATETIME(3) NULL,
    `reviewDate` DATETIME(3) NULL,
    `ownerId` CHAR(36) NOT NULL,
    `approvedById` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    UNIQUE INDEX `governance_policies_slug_key`(`slug`),
    INDEX `governance_policies_status_idx`(`status`),
    INDEX `governance_policies_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_incidents` (
    `id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `status` ENUM('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `aiSystemId` CHAR(36) NULL,
    `modelId` CHAR(36) NULL,
    `reportedById` CHAR(36) NOT NULL,
    `assignedToId` CHAR(36) NULL,
    `occurredAt` DATETIME(3) NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `impact` TEXT NULL,
    `rootCause` TEXT NULL,
    `correctiveActions` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `ai_incidents_status_severity_idx`(`status`, `severity`),
    INDEX `ai_incidents_aiSystemId_idx`(`aiSystemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_register_entries` (
    `id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `category` TEXT NOT NULL,
    `aiSystemId` CHAR(36) NULL,
    `likelihood` INTEGER NOT NULL,
    `impact` INTEGER NOT NULL,
    `inherentScore` INTEGER NOT NULL,
    `residualScore` INTEGER NULL,
    `mitigation` TEXT NULL,
    `status` ENUM('OPEN', 'MITIGATING', 'ACCEPTED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `ownerId` CHAR(36) NULL,
    `reviewDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    INDEX `risk_register_entries_status_idx`(`status`),
    INDEX `risk_register_entries_aiSystemId_idx`(`aiSystemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oversight_records` (
    `id` CHAR(36) NOT NULL,
    `aiSystemId` CHAR(36) NULL,
    `modelId` CHAR(36) NULL,
    `decisionReference` TEXT NOT NULL,
    `decision` ENUM('ACCEPTED_RECOMMENDATION', 'OVERRODE_RECOMMENDATION', 'ESCALATED', 'DEFERRED') NOT NULL,
    `rationale` TEXT NOT NULL,
    `reviewerId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oversight_records_aiSystemId_idx`(`aiSystemId`),
    INDEX `oversight_records_modelId_idx`(`modelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendor_assessments` (
    `id` CHAR(36) NOT NULL,
    `aiSystemId` CHAR(36) NULL,
    `vendorName` VARCHAR(255) NOT NULL,
    `productName` TEXT NOT NULL,
    `riskLevel` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NULL,
    `findings` JSON NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `assessorId` CHAR(36) NOT NULL,
    `assessmentDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `vendor_assessments_vendorName_idx`(`vendorName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `compliance_requirements` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(255) NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `framework` VARCHAR(255) NOT NULL,
    `category` TEXT NOT NULL,
    `status` ENUM('NOT_STARTED', 'IN_PROGRESS', 'EVIDENCE_PROVIDED', 'NEEDS_LEGAL_REVIEW', 'REVIEWED') NOT NULL DEFAULT 'NOT_STARTED',
    `evidence` TEXT NULL,
    `ownerId` CHAR(36) NULL,
    `requiresLegalReview` BOOLEAN NOT NULL DEFAULT true,
    `lastReviewedAt` DATETIME(3) NULL,
    `nextReviewAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,

    UNIQUE INDEX `compliance_requirements_code_key`(`code`),
    INDEX `compliance_requirements_framework_idx`(`framework`),
    INDEX `compliance_requirements_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_schedules` (
    `id` CHAR(36) NOT NULL,
    `resourceType` VARCHAR(255) NOT NULL,
    `resourceId` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `frequencyDays` INTEGER NOT NULL,
    `nextReviewAt` DATETIME(3) NOT NULL,
    `lastReviewedAt` DATETIME(3) NULL,
    `assigneeId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `review_schedules_resourceType_resourceId_idx`(`resourceType`, `resourceId`),
    INDEX `review_schedules_nextReviewAt_idx`(`nextReviewAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_requests` (
    `id` CHAR(36) NOT NULL,
    `resourceType` VARCHAR(255) NOT NULL,
    `resourceId` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `requestedById` CHAR(36) NOT NULL,
    `approverId` CHAR(36) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `comment` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `approval_requests_resourceType_resourceId_idx`(`resourceType`, `resourceId`),
    INDEX `approval_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `userEmail` TEXT NULL,
    `role` ENUM('SUPER_ADMIN', 'ADMIN', 'FACULTY', 'STUDENT', 'DEVELOPER', 'PRODUCT_DEVELOPER', 'EXECUTIVE') NULL,
    `action` VARCHAR(255) NOT NULL,
    `resource` VARCHAR(255) NOT NULL,
    `resourceId` VARCHAR(255) NULL,
    `ipAddress` TEXT NULL,
    `userAgent` TEXT NULL,
    `requestId` TEXT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `result` ENUM('SUCCESS', 'FAILURE', 'DENIED') NOT NULL DEFAULT 'SUCCESS',
    `reason` TEXT NULL,
    `severity` ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    INDEX `audit_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_resource_resourceId_idx`(`resource`, `resourceId`),
    INDEX `audit_logs_severity_idx`(`severity`),
    INDEX `audit_logs_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `type` ENUM('ASSIGNMENT_ASSIGNED', 'ASSIGNMENT_GRADED', 'COURSE_COMPLETED', 'LAB_COMPLETED', 'CERTIFICATE_ISSUED', 'RISK_ASSESSMENT_SUBMITTED', 'GOVERNANCE_REVIEW_REQUIRED', 'HIGH_RISK_MODEL_DETECTED', 'MODEL_REVIEW_DUE', 'SYSTEM') NOT NULL,
    `title` TEXT NOT NULL,
    `message` TEXT NOT NULL,
    `link` TEXT NULL,
    `metadata` JSON NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `notifications_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(255) NOT NULL,
    `value` JSON NOT NULL,
    `description` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` CHAR(36) NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_deletion_requests` ADD CONSTRAINT `data_deletion_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courses` ADD CONSTRAINT `courses_instructorId_fkey` FOREIGN KEY (`instructorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `modules` ADD CONSTRAINT `modules_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lessons` ADD CONSTRAINT `lessons_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `modules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress` ADD CONSTRAINT `progress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress` ADD CONSTRAINT `progress_lessonId_fkey` FOREIGN KEY (`lessonId`) REFERENCES `lessons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress` ADD CONSTRAINT `progress_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `modules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `labs` ADD CONSTRAINT `labs_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `labs` ADD CONSTRAINT `labs_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `modules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lab_attempts` ADD CONSTRAINT `lab_attempts_labId_fkey` FOREIGN KEY (`labId`) REFERENCES `labs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lab_attempts` ADD CONSTRAINT `lab_attempts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lab_attempts` ADD CONSTRAINT `lab_attempts_experimentId_fkey` FOREIGN KEY (`experimentId`) REFERENCES `experiments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `modules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `assignments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_gradedById_fkey` FOREIGN KEY (`gradedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quizzes` ADD CONSTRAINT `quizzes_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quizzes` ADD CONSTRAINT `quizzes_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `modules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `quizzes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_attempts` ADD CONSTRAINT `quiz_attempts_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `quizzes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quiz_attempts` ADD CONSTRAINT `quiz_attempts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `datasets` ADD CONSTRAINT `datasets_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dataset_columns` ADD CONSTRAINT `dataset_columns_datasetId_fkey` FOREIGN KEY (`datasetId`) REFERENCES `datasets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_models` ADD CONSTRAINT `ai_models_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_models` ADD CONSTRAINT `ai_models_aiSystemId_fkey` FOREIGN KEY (`aiSystemId`) REFERENCES `ai_systems`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_models` ADD CONSTRAINT `ai_models_trainingDatasetId_fkey` FOREIGN KEY (`trainingDatasetId`) REFERENCES `datasets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_versions` ADD CONSTRAINT `model_versions_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ai_models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_versions` ADD CONSTRAINT `model_versions_datasetId_fkey` FOREIGN KEY (`datasetId`) REFERENCES `datasets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_versions` ADD CONSTRAINT `model_versions_trainingExperimentId_fkey` FOREIGN KEY (`trainingExperimentId`) REFERENCES `experiments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experiments` ADD CONSTRAINT `experiments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experiments` ADD CONSTRAINT `experiments_datasetId_fkey` FOREIGN KEY (`datasetId`) REFERENCES `datasets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experiments` ADD CONSTRAINT `experiments_modelVersionId_fkey` FOREIGN KEY (`modelVersionId`) REFERENCES `model_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experiment_results` ADD CONSTRAINT `experiment_results_experimentId_fkey` FOREIGN KEY (`experimentId`) REFERENCES `experiments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_cards` ADD CONSTRAINT `model_cards_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ai_models`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_cards` ADD CONSTRAINT `model_cards_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_cards` ADD CONSTRAINT `model_cards_parentCardId_fkey` FOREIGN KEY (`parentCardId`) REFERENCES `model_cards`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessments` ADD CONSTRAINT `risk_assessments_aiSystemId_fkey` FOREIGN KEY (`aiSystemId`) REFERENCES `ai_systems`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessments` ADD CONSTRAINT `risk_assessments_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ai_models`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessments` ADD CONSTRAINT `risk_assessments_assessorId_fkey` FOREIGN KEY (`assessorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `algorithmic_impact_assessments` ADD CONSTRAINT `algorithmic_impact_assessments_aiSystemId_fkey` FOREIGN KEY (`aiSystemId`) REFERENCES `ai_systems`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `algorithmic_impact_assessments` ADD CONSTRAINT `algorithmic_impact_assessments_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `aia_status_history` ADD CONSTRAINT `aia_status_history_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `algorithmic_impact_assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_systems` ADD CONSTRAINT `ai_systems_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `governance_policies` ADD CONSTRAINT `governance_policies_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_incidents` ADD CONSTRAINT `ai_incidents_aiSystemId_fkey` FOREIGN KEY (`aiSystemId`) REFERENCES `ai_systems`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_incidents` ADD CONSTRAINT `ai_incidents_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ai_models`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_incidents` ADD CONSTRAINT `ai_incidents_reportedById_fkey` FOREIGN KEY (`reportedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_incidents` ADD CONSTRAINT `ai_incidents_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_register_entries` ADD CONSTRAINT `risk_register_entries_aiSystemId_fkey` FOREIGN KEY (`aiSystemId`) REFERENCES `ai_systems`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oversight_records` ADD CONSTRAINT `oversight_records_aiSystemId_fkey` FOREIGN KEY (`aiSystemId`) REFERENCES `ai_systems`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oversight_records` ADD CONSTRAINT `oversight_records_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ai_models`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vendor_assessments` ADD CONSTRAINT `vendor_assessments_aiSystemId_fkey` FOREIGN KEY (`aiSystemId`) REFERENCES `ai_systems`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

