/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { loadMechanicalDatasets } from './seed-data/mechanical';

/** Loads the mechanical datasets into an existing database without re-running the full seed. */
async function main() {
  const prisma = new PrismaClient();
  try {
    const owner = (await prisma.user.findUnique({ where: { email: 'faculty@example.com' } })) ?? (await prisma.user.findFirst({ where: { role: { name: 'SUPER_ADMIN' } } }));
    if (!owner) throw new Error('No owner found. Run the seed first (npm run db:seed).');
    console.log('Loading mechanical datasets…');
    const loaded = await loadMechanicalDatasets(prisma, owner.id);
    console.log(loaded.length ? `Loaded ${loaded.length} dataset(s).` : 'Nothing to load; all datasets are already present.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
