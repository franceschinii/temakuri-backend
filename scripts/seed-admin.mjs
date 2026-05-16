// Script local: cria (ou promove) uma conta admin no DB de desenvolvimento.
// Uso: node scripts/seed-admin.mjs <username> <password> <email>
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const username = process.argv[2] ?? 'admin';
const password = process.argv[3] ?? 'admin123';
const email = process.argv[4] ?? 'admin@temakuri.local';

const passwordHash = await bcrypt.hash(password, 10);

const existing = await prisma.user.findUnique({ where: { username } });

let user;
if (existing) {
  user = await prisma.user.update({
    where: { username },
    data: { isAdmin: true, passwordHash, isBanned: false, email },
  });
  console.log(`Usuario "${username}" ja existia — promovido a admin, email e senha redefinidos.`);
} else {
  user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      isAdmin: true,
      diamonds: 99999,
      coins: 99999,
      level: 100,
    },
  });
  await prisma.userInventory.create({
    data: {
      userId: user.id,
      unlockedAvatars: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      unlockedModes: ['TRADITIONAL', 'MERCADO', 'RODIZIO', 'DEGUSTACAO'],
      unlockedThemes: ['bambu', 'oceano', 'sakura', 'oni', 'gavioes'],
    },
  });
  console.log(`Usuario admin "${username}" criado com inventario completo.`);
}

console.log(JSON.stringify({ id: user.id, username, isAdmin: true }, null, 2));
await prisma.$disconnect();
