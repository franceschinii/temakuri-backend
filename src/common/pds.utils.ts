export const RANK_FLOORS: Record<string, number> = {
  Bronze:     0,
  Prata:      200,
  Ouro:       500,
  Platina:    1000,
  Diamante:   1800,
  Esmeralda:  2800,
  SuperSabor: 4000,
};

export function rankFromPds(pds: number): string {
  if (pds >= 4000) return 'SuperSabor';
  if (pds >= 2800) return 'Esmeralda';
  if (pds >= 1800) return 'Diamante';
  if (pds >= 1000) return 'Platina';
  if (pds >= 500)  return 'Ouro';
  if (pds >= 200)  return 'Prata';
  return 'Bronze';
}

export function clampPds(newPds: number, oldPds: number): number {
  // Floor previne PDS negativo (Bronze 0) e cair múltiplos tiers de uma vez:
  // só protege o floor do tier *atual*, permitindo demoção legítima para o tier anterior.
  const oldRank = rankFromPds(oldPds);
  const newRank = rankFromPds(newPds);
  if (newRank === oldRank) {
    const floor = RANK_FLOORS[oldRank] ?? 0;
    return Math.max(floor, newPds);
  }
  // Mudou de tier: aceita o novo PDS, mas garante que não fique abaixo do floor do novo tier
  const newFloor = RANK_FLOORS[newRank] ?? 0;
  return Math.max(newFloor, newPds);
}

export function calcPdsChange(
  placement: number,
  totalPlayers: number,
  winStreak: number,
  lossStreak: number,
): number {
  const base2p: Record<number, number> = { 1: 30, 2: -20 };
  const base: Record<number, number> = { 1: 30, 2: 10, 3: -10, 4: -20 };
  const delta = totalPlayers === 2
    ? (base2p[placement] ?? -20)
    : (base[placement] ?? -20);

  if (delta > 0 && winStreak >= 2) return delta + Math.min((winStreak - 1) * 10, 30);
  if (delta < 0 && lossStreak >= 3) return delta + 5;
  return delta;
}
