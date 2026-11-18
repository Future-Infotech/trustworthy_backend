import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { SELF_REGISTRATION_ELIGIBLE_ROLES } from '../rbac/permissions';
import { settingRepository } from '../repositories/setting.repository';
import { Errors } from '../utils/errors';
import type { RequestContext } from '../utils/requestContext';
import { auditService, type AuditActor } from './audit.service';

const selfRegistrationRole = z.enum(SELF_REGISTRATION_ELIGIBLE_ROLES as [string, ...string[]]);

export const SETTING_DEFINITIONS = {
  'registration.enabled': {
    category: 'Registration',
    description: 'Allow new users to create accounts from the public registration page.',
    schema: z.boolean(),
    default: true,
  },
  'registration.allowedRoles': {
    category: 'Registration',
    description: 'Roles a user may choose during self-registration. Privileged roles can only be granted by administrators.',
    schema: z.array(selfRegistrationRole).min(1),
    default: ['STUDENT'],
  },
  'security.maxFailedLogins': {
    category: 'Security',
    description: 'Consecutive failed sign-in attempts before an account is temporarily locked.',
    schema: z.number().int().min(3).max(20),
    default: 5,
  },
  'security.lockoutMinutes': {
    category: 'Security',
    description: 'Duration of a temporary account lock after too many failed sign-ins.',
    schema: z.number().int().min(1).max(1440),
    default: 15,
  },
  'uploads.maxDatasetSizeMb': {
    category: 'Uploads',
    description: 'Maximum CSV dataset upload size in megabytes.',
    schema: z.number().int().min(1).max(200),
    default: 25,
  },
  'uploads.maxModelSizeMb': {
    category: 'Uploads',
    description: 'Maximum serialized model artifact size in megabytes.',
    schema: z.number().int().min(1).max(500),
    default: 100,
  },
  'uploads.maxCourseMediaMb': {
    category: 'Uploads',
    description: 'Maximum size of a lesson video, slide image or PDF upload in megabytes. Host long videos on a video platform or CDN instead.',
    schema: z.number().int().min(1).max(500),
    default: 100,
  },
  'privacy.datasetRetentionDays': {
    category: 'Privacy',
    description: 'Default number of days uploaded datasets are retained before scheduled deletion.',
    schema: z.number().int().min(7).max(3650),
    default: 365,
  },
  'privacy.auditLogRetentionDays': {
    category: 'Privacy',
    description: 'Number of days audit events are retained. Set according to your legal and policy obligations.',
    schema: z.number().int().min(365).max(3650),
    default: 2555,
  },
  'privacy.maskSensitiveFields': {
    category: 'Privacy',
    description: 'Mask values of columns flagged as sensitive in dataset previews.',
    schema: z.boolean(),
    default: true,
  },
  'ml.maxExperimentSeconds': {
    category: 'AI Experiments',
    description: 'Hard execution time limit for a single sandboxed experiment.',
    schema: z.number().int().min(10).max(1800),
    default: 300,
  },
  'ml.maxConcurrentJobsPerUser': {
    category: 'AI Experiments',
    description: 'Maximum queued or running experiments per user.',
    schema: z.number().int().min(1).max(10),
    default: 2,
  },
  'platform.educationalDisclaimer': {
    category: 'Platform',
    description: 'Disclaimer shown alongside experiment and assessment results.',
    schema: z.string().min(10).max(1000),
    default:
      'Results produced on this platform are educational and analytical aids. They are not proof of regulatory compliance and must be reviewed by qualified humans before informing real-world decisions.',
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>;

export const isSettingKey = (key: string): key is SettingKey => key in SETTING_DEFINITIONS;

const CACHE_TTL_MS = 30_000;
let cache: { values: Map<string, unknown>; loadedAt: number } | null = null;

async function loadValues(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.values;
  const rows = await settingRepository.findAll();
  const values = new Map<string, unknown>();
  for (const row of rows) {
    if (!isSettingKey(row.key)) continue;
    const parsed = SETTING_DEFINITIONS[row.key].schema.safeParse(row.value);
    if (parsed.success) values.set(row.key, parsed.data);
  }
  cache = { values, loadedAt: Date.now() };
  return values;
}

export const settingsService = {
  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const values = await loadValues();
    return (values.has(key) ? values.get(key) : SETTING_DEFINITIONS[key].default) as SettingValue<K>;
  },

  async list() {
    const [values, rows] = await Promise.all([loadValues(), settingRepository.findAll()]);
    const rowByKey = new Map(rows.map((r) => [r.key, r]));
    return (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => {
      const def = SETTING_DEFINITIONS[key];
      return {
        key,
        category: def.category,
        description: def.description,
        value: values.has(key) ? values.get(key) : def.default,
        defaultValue: def.default,
        isDefault: !values.has(key),
        updatedAt: rowByKey.get(key)?.updatedAt ?? null,
        updatedById: rowByKey.get(key)?.updatedById ?? null,
      };
    });
  },

  async update(key: string, value: unknown, actor: AuditActor, ctx: RequestContext) {
    if (!isSettingKey(key)) throw Errors.notFound('Setting');
    const def = SETTING_DEFINITIONS[key];
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues.map((i) => ({ path: ['value', ...i.path].join('.'), message: i.message })));
    }

    await prisma.$transaction(async (tx) => {
      const previous = await settingRepository.findByKey(key, tx);
      await settingRepository.upsert(key, parsed.data as Prisma.InputJsonValue, def.description, actor.id, tx);
      await auditService.record(
        {
          action: 'settings.update',
          resource: 'system_setting',
          resourceId: key,
          actor,
          context: ctx,
          before: { value: previous?.value ?? def.default },
          after: { value: parsed.data },
          severity: key.startsWith('security.') || key.startsWith('privacy.') ? 'HIGH' : 'MEDIUM',
        },
        tx,
      );
    });
    cache = null;
    return (await this.list()).find((s) => s.key === key)!;
  },

  clearCache(): void {
    cache = null;
  },
};
