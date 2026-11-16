import { toMarkdown } from '../../src/services/reports/document';
import { experimentReport, type ExperimentForReport } from '../../src/services/reports/experimentReport';

const disparities = (dp: number, eo: number, ratio: number) => ({
  demographicParityDifference: dp,
  demographicParityRatio: ratio,
  equalOpportunityDifference: eo,
  falsePositiveRateDifference: 0.1,
  equalizedOddsDifference: eo,
  accuracyDifference: 0.05,
});

const base: Omit<ExperimentForReport, 'type' | 'results'> = {
  id: 'exp-1',
  name: null,
  algorithm: 'RANDOM_FOREST',
  randomSeed: 11,
  configHash: 'abc',
  isEducational: true,
  completedAt: new Date('2026-10-01T00:00:00Z'),
  durationMs: 3500,
  owner: 'Maya Chen',
  dataset: 'Loans',
  modelVersion: 'Credit v1',
};

describe('experimentReport', () => {
  it('reports the trade-off and every disparity the mitigation made worse', () => {
    const md = toMarkdown(
      experimentReport(
        {
          ...base,
          type: 'FAIRNESS_MITIGATION',
          results: [
            {
              kind: 'fairness_mitigation',
              data: {
                algorithm: 'RANDOM_FOREST',
                attribute: 'gender',
                positiveLabel: 'yes',
                baseline: { overall: { accuracy: 0.907 }, groups: [], disparities: disparities(0.1145, 0.0265, 0.85) },
                mitigations: [
                  {
                    label: 'Threshold Optimizer',
                    usesSensitiveAtPrediction: true,
                    overall: { accuracy: 0.84 },
                    groups: [],
                    disparities: disparities(0.042, 0.2807, 0.93),
                    tradeoff: { targetMetric: 'demographicParityDifference', before: 0.1145, after: 0.042, disparityChange: -0.0725, accuracyChange: -0.067, summary: 'The targeted gap fell.' },
                  },
                ],
                notes: [],
                warnings: [],
              },
            },
          ],
        },
        'Educational disclaimer.',
      ),
    );
    expect(md).toContain('| Threshold Optimizer | 84% | -6.7% | Demographic parity difference | 0.1145 | 0.042 | -0.0725 |');
    expect(md).toContain('Threshold Optimizer: Equal opportunity difference worsened from 0.027 to 0.281.');
    expect(md).not.toContain('Demographic parity ratio worsened');
    expect(md).toContain('requires legal review');
    expect(md).toContain('EDUCATIONAL SIMULATION');
    expect(md).toContain('Educational disclaimer.');
  });

  it('marks non-educational runs without the simulation watermark and ignores unknown result kinds', () => {
    const doc = experimentReport({ ...base, isEducational: false, type: 'SHAP', results: [{ kind: 'training', data: {} }] }, 'd');
    expect(doc.watermark).toBeUndefined();
    expect(doc.sections.map((s) => s.heading)).toEqual(['Interpretation and limitations']);
  });
});
