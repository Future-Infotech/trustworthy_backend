import { createHash } from 'node:crypto';

/**
 * Synthetic "Loan Applications" dataset for the labs.
 *
 * Generated deterministically from a fixed seed. Historical approvals include a
 * deliberate penalty for some gender and age groups so that learners can detect
 * and mitigate bias. No real individuals are represented.
 */
export const LOAN_DATASET_SEED = 20260101;
export const LOAN_DATASET_ROWS = 1000;
export const LOAN_SENSITIVE_COLUMNS = ['applicant_id', 'gender', 'age', 'age_group'];
export const LOAN_TARGET = 'approved';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

type Row = Record<string, string | number | null>;

export function generateLoanDataset(seed = LOAN_DATASET_SEED, n = LOAN_DATASET_ROWS): Row[] {
  const rand = mulberry32(seed);
  const normal = (mean: number, sd: number) => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const pick = <T>(items: [T, number][]): T => {
    const r = rand();
    let acc = 0;
    for (const [item, p] of items) {
      acc += p;
      if (r < acc) return item;
    }
    return items[items.length - 1][0];
  };

  const rows: Row[] = [];
  for (let i = 1; i <= n; i++) {
    const gender = pick<string>([['Female', 0.48], ['Male', 0.5], ['Non-binary', 0.02]]);
    const age = Math.round(clamp(normal(40, 11), 19, 72));
    const ageGroup = age <= 25 ? '18-25' : age <= 40 ? '26-40' : age <= 60 ? '41-60' : '60+';
    const region = pick<string>([['North', 0.3], ['South', 0.25], ['East', 0.25], ['West', 0.2]]);
    const income = Math.round(Math.exp(normal(10.9, 0.38)) * (gender === 'Male' ? 1 : 0.92) / 100) * 100;
    const loanAmount = Math.round(clamp(income * clamp(normal(0.6, 0.3), 0.1, 1.8), 5000, 150000) / 500) * 500;
    const creditYears = Math.round(clamp(normal(Math.min(age - 18, 12), 5), 0, age - 18));
    const dti = Number(clamp(normal(0.33, 0.13), 0.03, 0.85).toFixed(3));
    const employmentYears = rand() < 0.03 ? null : Math.round(clamp(normal(Math.min(age - 20, 8), 4), 0, age - 18));
    const existingLoans = Math.floor(clamp(normal(1.2, 1.1), 0, 5));

    const incomeZ = (Math.log(income) - 10.9) / 0.38;
    let score =
      0.4 + 1.1 * incomeZ - 5.5 * (dti - 0.33) + 0.06 * (creditYears - 10) - 0.35 * existingLoans - 0.9 * (loanAmount / income - 0.6);
    // Historical bias encoded deliberately for teaching purposes.
    if (gender !== 'Male') score -= 0.55;
    if (ageGroup === '18-25') score -= 0.6;
    if (region === 'South') score -= 0.2;
    const approved = rand() < sigmoid(score + normal(0, 0.5)) ? 1 : 0;

    rows.push({
      applicant_id: `APP-${String(i).padStart(5, '0')}`,
      age,
      age_group: ageGroup,
      gender,
      region,
      annual_income: income,
      loan_amount: loanAmount,
      credit_history_years: creditYears,
      debt_to_income: dti,
      employment_years: employmentYears,
      existing_loans: existingLoans,
      approved,
    });
  }
  return rows;
}

export function toCsv(rows: Row[]): string {
  const headers = Object.keys(rows[0]);
  const lines = rows.map((r) => headers.map((h) => (r[h] === null ? '' : String(r[h]))).join(','));
  return [headers.join(','), ...lines].join('\n') + '\n';
}

const round = (v: number, d = 4) => Number(v.toFixed(d));

/**
 * Fairness audit of the historical decisions (labels) in a dataset.
 * This measures bias in the data itself; model-based audits (TPR/FPR,
 * mitigation) run in the ML service.
 */
export function auditHistoricalOutcomes(rows: Row[], target: string, protectedAttributes: string[]) {
  return protectedAttributes.map((attribute) => {
    const groups = new Map<string, { count: number; positive: number }>();
    for (const r of rows) {
      const g = String(r[attribute]);
      const entry = groups.get(g) ?? { count: 0, positive: 0 };
      entry.count++;
      entry.positive += Number(r[target]) === 1 ? 1 : 0;
      groups.set(g, entry);
    }
    const byGroup = [...groups.entries()]
      .map(([group, { count, positive }]) => ({ group, count, positives: positive, selectionRate: round(positive / count) }))
      .sort((a, b) => b.count - a.count);
    const rates = byGroup.map((g) => g.selectionRate);
    const max = Math.max(...rates);
    const min = Math.min(...rates);
    const disparityRatio = max === 0 ? 1 : round(min / max);
    return {
      attribute,
      byGroup,
      demographicParityDifference: round(max - min),
      disparityRatio,
      fourFifthsRuleViolated: disparityRatio < 0.8,
      smallGroupWarning: byGroup.filter((g) => g.count < 30).map((g) => g.group),
    };
  });
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
