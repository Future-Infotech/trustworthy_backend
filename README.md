# TrustAI360 Backend

Node.js + Express + TypeScript API for the Trustworthy AI platform (JWT auth, RBAC, learning, experiments, governance, assignments, certificates, reports).

## Requirements

- Node.js ≥ 18.18
- PostgreSQL 16
- Optional: Redis (shared rate limits), ML service on port 8000

## Setup

```bash
cp .env.example .env   # set DATABASE_URL, JWT_ACCESS_SECRET, ML_SERVICE_TOKEN
npm install
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run dev            # http://localhost:4000 — Swagger at /api/docs
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | API with hot reload |
| `npm run build` / `npm start` | Production build and run |
| `npm test` | Vitest unit + integration tests |
| `npm run prisma:migrate` | Create a migration |
| `npm run prisma:deploy` | Apply migrations |
| `npm run prisma:seed` | Seed RBAC and demo data |

Prisma schema and migrations live in `prisma/`. Demo accounts use `SEED_DEFAULT_PASSWORD` (development default `TrustAI!2026`).
