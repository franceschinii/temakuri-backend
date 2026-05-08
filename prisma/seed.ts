import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seed completed (no seed data required for Temakuri)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
