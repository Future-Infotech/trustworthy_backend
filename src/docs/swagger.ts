import { Router } from 'express';
import helmet from 'helmet';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

export function loadOpenApiSpec(): Record<string, unknown> {
  return YAML.parse(readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'));
}

export function docsRouter(): Router {
  const spec = loadOpenApiSpec();
  const router = Router();
  router.get('/openapi.json', (_req, res) => res.json(spec));
  router.use(
    '/',
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
    swaggerUi.serve,
    swaggerUi.setup(spec, { customSiteTitle: 'Trustworthy AI Platform API' }),
  );
  return router;
}
