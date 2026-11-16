import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'dist', 'docs'), { recursive: true });
cpSync(path.join(root, 'src', 'docs', 'openapi.yaml'), path.join(root, 'dist', 'docs', 'openapi.yaml'));
