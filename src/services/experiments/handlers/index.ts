import type { ExperimentType } from '@prisma/client';
import type { ExperimentHandler } from '../types';
import { datasetAnalysisHandler } from './dataset.handler';
import { fairnessAuditHandler, fairnessMitigationHandler } from './fairness.handler';
import { adversarialTrainingHandler, fgsmHandler, pgdHandler } from './robustness.handler';
import { trainingHandler } from './training.handler';
import { counterfactualHandler, gradCamHandler, limeHandler, shapHandler } from './xai.handler';

const HANDLERS: Partial<Record<ExperimentType, ExperimentHandler>> = {
  DATASET_ANALYSIS: datasetAnalysisHandler,
  TRAINING: trainingHandler,
  SHAP: shapHandler,
  LIME: limeHandler,
  COUNTERFACTUAL: counterfactualHandler,
  GRAD_CAM: gradCamHandler,
  FAIRNESS_AUDIT: fairnessAuditHandler,
  FAIRNESS_MITIGATION: fairnessMitigationHandler,
  FGSM: fgsmHandler,
  PGD: pgdHandler,
  ADVERSARIAL_TRAINING: adversarialTrainingHandler,
};

export function handlerFor(type: ExperimentType): ExperimentHandler | undefined {
  return HANDLERS[type];
}

export const SUPPORTED_EXPERIMENT_TYPES = Object.keys(HANDLERS) as ExperimentType[];
