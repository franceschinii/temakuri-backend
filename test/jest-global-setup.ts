import { execSync } from 'node:child_process';

export default async function globalSetup() {
  if (!process.env.DATABASE_URL?.includes('temakuri_test')) {
    throw new Error(
      `DATABASE_URL não aponta para o banco de teste (esperado conter 'temakuri_test'). Valor atual: ${process.env.DATABASE_URL}`,
    );
  }

  // Workaround temporário: `db push` sincroniza schema → DB direto.
  // Existe drift entre prisma/migrations/ e schema.prisma; trocar para
  // `prisma migrate deploy` assim que a migration catch-up for commitada.
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: process.env,
  });
}
