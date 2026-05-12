export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.15, level - 1));
}

export function computeLevel(totalXp: number): number {
  let level = 1;
  let accumulated = 0;
  while (level < 100) {
    const needed = xpForLevel(level);
    if (accumulated + needed > totalXp) break;
    accumulated += needed;
    level++;
  }
  return level;
}

export function xpGain(placement: number, totalPlayers: number): number {
  const tables: Record<number, Record<number, number>> = {
    2: { 1: 35, 2: 10 },
    3: { 1: 40, 2: 25, 3: 10 },
    4: { 1: 50, 2: 30, 3: 20, 4: 10 },
  };
  const count = Math.min(Math.max(totalPlayers, 2), 4);
  return tables[count]?.[placement] ?? 10;
}

export function coinsGain(placement: number, totalPlayers: number): number {
  if (totalPlayers === 2) return placement === 1 ? 4 : 1;
  if (totalPlayers === 3) return ({ 1: 4, 2: 2, 3: 1 } as Record<number, number>)[placement] ?? 1;
  return ({ 1: 6, 2: 3, 3: 2, 4: 1 } as Record<number, number>)[placement] ?? 1;
}
