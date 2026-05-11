import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const rooms = await p.room.findMany({
  orderBy: { createdAt: 'desc' },
  include: { players: { include: { user: { select: { username: true } } } } },
});
for (const r of rooms) {
  console.log(`${r.code} | private=${r.isPrivate} | status=${r.status} | host=${r.players.find(p => p.userId === r.hostId)?.user.username ?? '?'} | players=${r.players.map(p => p.user.username).join(',')}`);
}
console.log(`\nTotal: ${rooms.length}`);
await p.$disconnect();
