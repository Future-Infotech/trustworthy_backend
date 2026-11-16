import type { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { loadOpenApiSpec } from '../../src/docs/swagger';
import { apiRouter } from '../../src/routes';

type Layer = { route?: { path: string; methods: Record<string, boolean> }; name: string; handle: Router & { stack?: Layer[] }; regexp: RegExp };

/** Express 4 keeps mount paths only as regexps; recover the literal prefix of a `router.use('/x', ...)` layer. */
function mountPath(layer: Layer): string {
  const source = layer.regexp.source.replace('^', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
  return source === '/?$' || source === '' ? '' : source;
}

function collect(stack: Layer[], prefix = ''): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const path = (prefix + layer.route.path).replace(/\/$/, '') || '/';
      return Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${path.replace(/:(\w+)/g, '{$1}')}`);
    }
    if (layer.name === 'router' && layer.handle.stack) return collect(layer.handle.stack, prefix + mountPath(layer));
    return [];
  });
}

describe('OpenAPI document', () => {
  const spec = loadOpenApiSpec() as { paths: Record<string, Record<string, unknown>> };
  const documented = new Set(Object.entries(spec.paths).flatMap(([path, ops]) => Object.keys(ops).filter((k) => k !== 'parameters').map((m) => `${m.toUpperCase()} ${path.replace(/\{\w+\}/g, '{}')}`)));
  const implemented = [...new Set(collect((apiRouter as unknown as { stack: Layer[] }).stack))];

  it('finds the mounted routes', () => {
    expect(implemented.length).toBeGreaterThan(150);
  });

  it('documents every implemented endpoint', () => {
    const missing = implemented.filter((r) => !documented.has(r.replace(/\{\w+\}/g, '{}')));
    expect(missing).toEqual([]);
  });

  it('resolves every $ref', () => {
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1]);
    const unresolved = refs.filter((ref) => ref.split('/').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], spec) === undefined);
    expect([...new Set(unresolved)]).toEqual([]);
  });

  it('does not document endpoints that do not exist', () => {
    const normalised = new Set(implemented.map((r) => r.replace(/\{\w+\}/g, '{}')));
    expect([...documented].filter((r) => !normalised.has(r))).toEqual([]);
  });
});
