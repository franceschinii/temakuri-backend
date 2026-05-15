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

/**
 * Recompensa por desempenho. Nova regra: so existe 1 perdedor por partida
 * (o que zerou os pratos). Todos os outros sao vencedores e recebem o mesmo
 * valor base. Por isso usamos `isWinner` em vez de placement.
 *
 * Multiplicadores adicionais (1v1, ranked) sao aplicados em rooms.service.
 */
export function xpGain(isWinner: boolean, totalPlayers: number): number {
  const winners: Record<number, number> = { 2: 35, 3: 40, 4: 50, 5: 55, 6: 60 };
  const count = Math.min(Math.max(totalPlayers, 2), 6);
  if (isWinner) return winners[count] ?? 35;
  return 10;
}

export function coinsGain(isWinner: boolean, totalPlayers: number): number {
  const winners: Record<number, number> = { 2: 4, 3: 4, 4: 6, 5: 7, 6: 8 };
  const count = Math.min(Math.max(totalPlayers, 2), 6);
  if (isWinner) return winners[count] ?? 4;
  return 1;
}

/**
 * Multiplicador de moedas: 1v1 paga +50%, ranqueada paga +50%.
 * Combinados (ranked 1v1) ficam em +125% (1.5 * 1.5 = 2.25).
 */
export function coinsMultiplier(totalPlayers: number, isRanked: boolean): number {
  let mult = 1;
  if (totalPlayers === 2) mult *= 1.5;
  if (isRanked) mult *= 1.5;
  return mult;
}
