import { z } from 'zod';

export const REPORT_TYPES = ['experiment', 'model_card', 'risk_assessment', 'impact_assessment'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportFormat = 'json' | 'md' | 'pdf';

export const reportParams = z.object({ type: z.enum(REPORT_TYPES), id: z.string().uuid('Invalid id') });

export const reportFormatQuery = z.object({ format: z.enum(['json', 'md', 'pdf']).default('pdf') });

export const reportSourcesQuery = z.object({ scope: z.enum(['mine', 'all']).default('mine') });
export type ReportSourcesQuery = z.infer<typeof reportSourcesQuery>;
