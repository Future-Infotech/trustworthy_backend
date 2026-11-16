import type { ExperimentType } from '@prisma/client';
import { z } from 'zod';
import type { Permission } from '../../../rbac/permissions';
import type { ExperimentHandler } from '../types';

/**
 * One experiment type served by several handlers (e.g. an attack on a registered model or on the
 * built-in image model). `pick` chooses the handler from the raw parameters; validation errors keep
 * the chosen handler's field paths.
 */
export function variantHandler(type: ExperimentType, permission: Permission, pick: (params: unknown) => ExperimentHandler): ExperimentHandler {
  return {
    type,
    permission,
    job: type.toLowerCase(),
    input: z.unknown().transform((raw, ctx) => {
      const parsed = pick(raw).input.safeParse(raw);
      if (parsed.success) return parsed.data as unknown;
      for (const issue of parsed.error.issues) ctx.addIssue(issue as z.IssueData);
      return z.NEVER;
    }),
    jobFor: (input) => pick(input).job,
    prepare: (input, auth) => pick(input).prepare(input, auth),
    jobParams: (input, experiment) => pick(input).jobParams(input, experiment),
    complete: (result, input, ctx) => pick(input).complete(result, input, ctx),
    rerunInput: (input) => pick(input).rerunInput?.(input) ?? input,
  };
}
