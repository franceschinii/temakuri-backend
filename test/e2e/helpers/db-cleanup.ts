import { PrismaService } from '../../../src/prisma/prisma.service.js';

export async function resetDb(prisma: PrismaService): Promise<void> {
  // Ordem importa: GameResult e Room não têm onDelete: Cascade vs User.
  // RoomPlayer cascateia de Room. User cascade cobre o resto (Session, Stats,
  // Inventory, RankedStats, PasswordResetToken).
  await prisma.gameResult.deleteMany({});
  await prisma.room.deleteMany({});
  await prisma.user.deleteMany({});
}
