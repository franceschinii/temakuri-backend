import { Card, GameMode, GamePhase, ClientGameState, PublicPlayerState, GameRanking, GameStats } from '../../types/game.types.js';
import { dealCards, shuffle, buildDeck } from './deck.js';
import { validatePlayIndices, isSabor, isSameCategory } from './rules.js';
import { INITIAL_TOKENS, MARKET_SIZE, TURN_TIMEOUT_MS } from '../../common/constants/game.constants.js';

interface PlayerState {
  userId: string;
  username: string;
  avatarIndex: number;
  seat: number;
  hand: Card[];
  tokensLeft: number;
  isConnected: boolean;
  isEliminated: boolean;
  isReady: boolean;
}

interface EngineResult {
  success: boolean;
  reason?: string;
  events: EngineEvent[];
}

export interface EngineEvent {
  type: string;
  payload: Record<string, unknown>;
  targetUserId?: string;
}

export class GameEngine {
  private players: PlayerState[] = [];
  private phase: GamePhase = 'DEALING';
  private round = 0;
  private currentTurnIndex = 0;
  private pile: Card[] = [];
  private drawPile: Card[] = [];
  private market: Card[] | null = null;
  private saborActive = false;
  private saborMinRequired = 0;
  private consecutivePasses = 0;
  private lastWiperId: string | null = null;
  private lastPlayerId: string | null = null;
  private mode: GameMode;
  private roomCode: string;
  private turnTimer: NodeJS.Timeout | null = null;
  private saborTriggersThisGame = 0;
  private tricksWon: Record<string, number> = {};

  constructor(roomCode: string, mode: GameMode) {
    this.roomCode = roomCode;
    this.mode = mode;
  }

  addPlayer(userId: string, username: string, avatarIndex: number, seat: number) {
    this.players.push({
      userId,
      username,
      avatarIndex,
      seat,
      hand: [],
      tokensLeft: INITIAL_TOKENS,
      isConnected: true,
      isEliminated: false,
      isReady: false,
    });
    this.tricksWon[userId] = 0;
  }

  setReady(userId: string, ready: boolean) {
    const p = this.findPlayer(userId);
    if (p) p.isReady = ready;
  }

  allReady(): boolean {
    return this.players.filter(p => !p.isEliminated).every(p => p.isReady);
  }

  startRound(): EngineEvent[] {
    this.round++;
    this.pile = [];
    this.saborActive = false;
    this.saborMinRequired = 0;
    this.consecutivePasses = 0;
    this.lastPlayerId = null;
    this.phase = 'DEALING';

    const activePlayers = this.activePlayers();
    const { hands, drawPile } = dealCards(activePlayers.map(p => p.userId));
    activePlayers.forEach(p => { p.hand = hands.get(p.userId) ?? []; });
    this.drawPile = drawPile;

    if (this.mode === 'MERCADO') {
      // Take market cards from front of draw pile to avoid duplicates
      this.market = this.drawPile.splice(0, MARKET_SIZE);
    }

    if (this.lastWiperId) {
      const idx = activePlayers.findIndex(p => p.userId === this.lastWiperId);
      if (idx !== -1) this.currentTurnIndex = idx;
    } else {
      this.currentTurnIndex = 0;
    }

    this.phase = 'PLAYER_TURN';

    const events: EngineEvent[] = [];

    activePlayers.forEach(p => {
      events.push({
        type: 'game:your_hand',
        payload: { hand: p.hand },
        targetUserId: p.userId,
      });
    });

    events.push({
      type: 'game:turn_started',
      payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS },
    });

    return events;
  }

  applyPlayCards(userId: string, cardIndices: number[]): EngineResult {
    if (this.phase !== 'PLAYER_TURN') return this.fail('Not the right phase');
    if (this.currentPlayer().userId !== userId) return this.fail('Not your turn');

    const player = this.findPlayer(userId)!;
    const validation = validatePlayIndices(
      player.hand,
      cardIndices,
      this.pile,
      this.saborActive,
      this.saborMinRequired,
    );

    if (!validation.valid) return this.fail(validation.reason!);

    const sorted = [...cardIndices].sort((a, b) => a - b);
    const playedCards = sorted.map(i => player.hand[i]);
    player.hand = player.hand.filter((_, i) => !sorted.includes(i));

    const saborTriggered = isSabor(playedCards);
    this.pile = playedCards;
    this.consecutivePasses = 0;
    this.lastPlayerId = userId;

    const events: EngineEvent[] = [];

    if (saborTriggered) {
      this.saborActive = true;
      this.saborMinRequired = playedCards.length;
      this.saborTriggersThisGame++;
      events.push({ type: 'game:sabor_active', payload: { triggeredBy: userId, minRequired: playedCards.length } });
    } else if (this.saborActive && !isSameCategory(playedCards)) {
      this.saborActive = false;
      this.saborMinRequired = 0;
      events.push({ type: 'game:sabor_broken', payload: { brokenBy: userId } });
    }

    events.push({ type: 'game:cards_played', payload: { userId, cards: playedCards, isSabor: saborTriggered } });
    events.push({ type: 'game:your_hand', payload: { hand: player.hand }, targetUserId: userId });

    if (player.hand.length === 0) {
      return { success: true, events: [...events, ...this.resolveRoundEnd(userId)] };
    }

    this.advanceTurn();
    events.push({ type: 'game:turn_started', payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS } });

    return { success: true, events };
  }

  applyPassTurn(userId: string, insertAtIndex: number): EngineResult {
    if (this.phase !== 'PLAYER_TURN') return this.fail('Not the right phase');
    if (this.currentPlayer().userId !== userId) return this.fail('Not your turn');

    const player = this.findPlayer(userId)!;
    // Draw from the finite deck (monte) — null if exhausted
    const drawnCard = this.drawPile.length > 0 ? this.drawPile.shift()! : null;

    if (drawnCard) {
      const clampedInsert = Math.max(0, Math.min(insertAtIndex, player.hand.length));
      player.hand.splice(clampedInsert, 0, drawnCard);
    }

    this.consecutivePasses++;

    const events: EngineEvent[] = [];
    events.push({
      type: 'game:turn_passed',
      payload: { userId, drawnCard, drawPileCount: this.drawPile.length },
    });
    if (drawnCard) {
      events.push({ type: 'game:your_hand', payload: { hand: player.hand }, targetUserId: userId });
    }

    const activePlayers = this.activePlayers();
    if (this.consecutivePasses >= activePlayers.length - 1) {
      const wipeWinner = this.lastPlayerId ?? userId;
      return { success: true, events: [...events, ...this.resolveWipe(wipeWinner)] };
    }

    this.advanceTurn();
    events.push({ type: 'game:turn_started', payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS } });

    return { success: true, events };
  }

  applyMarketSwap(userId: string, handIndex: number, marketIndex: number): EngineResult {
    if (this.mode !== 'MERCADO') return this.fail('Not in Mercado mode');
    if (!this.market) return this.fail('No market available');
    if (this.lastWiperId !== userId) return this.fail('Only the wipe winner can swap');

    const player = this.findPlayer(userId)!;
    if (handIndex < 0 || handIndex >= player.hand.length) return this.fail('Invalid hand index');
    if (marketIndex < 0 || marketIndex >= this.market.length) return this.fail('Invalid market index');

    const handCard = player.hand[handIndex];
    const marketCard = this.market[marketIndex];
    player.hand[handIndex] = marketCard;
    this.market[marketIndex] = handCard;

    return {
      success: true,
      events: [
        { type: 'game:market_updated', payload: { market: this.market } },
        { type: 'game:your_hand', payload: { hand: player.hand }, targetUserId: userId },
      ],
    };
  }

  setPlayerConnected(userId: string, connected: boolean): EngineEvent[] {
    const p = this.findPlayer(userId);
    if (!p) return [];
    p.isConnected = connected;

    if (!connected && this.phase === 'PLAYER_TURN' && this.currentPlayer().userId === userId) {
      return [{
        type: 'game:player_disconnected',
        payload: { userId, autoPassIn: TURN_TIMEOUT_MS },
      }];
    }

    return [{ type: connected ? 'game:player_reconnected' : 'game:player_disconnected', payload: { userId } }];
  }

  getClientStateFor(userId: string): ClientGameState {
    return {
      roomCode: this.roomCode,
      mode: this.mode,
      phase: this.phase,
      round: this.round,
      currentTurnUserId: this.currentPlayer()?.userId ?? '',
      players: this.players.map(p => this.toPublicPlayer(p)),
      pile: this.pile,
      drawPileCount: this.drawPile.length,
      market: this.market,
      saborActive: this.saborActive,
      saborMinRequired: this.saborMinRequired,
      consecutivePasses: this.consecutivePasses,
      myHand: this.findPlayer(userId)?.hand ?? [],
    };
  }

  getStats(): GameStats {
    return {
      totalRounds: this.round,
      saborTriggers: this.saborTriggersThisGame,
      tricksWon: { ...this.tricksWon },
    };
  }

  private resolveWipe(wiperId: string): EngineEvent[] {
    this.lastWiperId = wiperId;
    this.pile = [];
    this.saborActive = false;
    this.saborMinRequired = 0;
    this.consecutivePasses = 0;
    this.tricksWon[wiperId] = (this.tricksWon[wiperId] ?? 0) + 1;

    const wiperIndex = this.activePlayers().findIndex(p => p.userId === wiperId);
    this.currentTurnIndex = wiperIndex;
    this.phase = 'WIPE_RESOLUTION';

    this.phase = 'PLAYER_TURN';

    const events: EngineEvent[] = [{ type: 'game:wipe', payload: { winnerId: wiperId } }];
    events.push({ type: 'game:turn_started', payload: { userId: wiperId, timeoutMs: TURN_TIMEOUT_MS } });
    return events;
  }

  private resolveRoundEnd(winnerId: string): EngineEvent[] {
    this.phase = 'ROUND_END';

    const active = this.activePlayers();
    const losers = active.filter(p => p.userId !== winnerId);
    losers.forEach(p => { p.tokensLeft = Math.max(0, p.tokensLeft - 1); });

    const playerTokens: Record<string, number> = {};
    this.players.forEach(p => { playerTokens[p.userId] = p.tokensLeft; });

    const events: EngineEvent[] = [{
      type: 'game:round_ended',
      payload: { loserIds: losers.map(p => p.userId), playerTokens },
    }];

    const justEliminated = losers.filter(p => p.tokensLeft === 0);
    justEliminated.forEach((p, i) => {
      p.isEliminated = true;
      events.push({ type: 'game:player_eliminated', payload: { userId: p.userId, placement: this.activePlayers().length - i } });
    });

    const stillActive = this.activePlayers();
    if (stillActive.length <= 1) {
      return [...events, ...this.resolveGameOver(winnerId)];
    }

    if (this.mode === 'RODIZIO') {
      this.rotateHands();
    }

    this.lastWiperId = winnerId;
    return [...events, ...this.startRound()];
  }

  private resolveGameOver(winnerId: string): EngineEvent[] {
    this.phase = 'GAME_OVER';

    const sorted = [...this.players].sort((a, b) => b.tokensLeft - a.tokensLeft);
    const rankings: GameRanking[] = sorted.map((p, i) => ({
      userId: p.userId,
      username: p.username,
      placement: i + 1,
      tokensLeft: p.tokensLeft,
    }));

    return [{
      type: 'game:game_over',
      payload: { rankings, stats: this.getStats() },
    }];
  }

  private rotateHands() {
    const active = this.activePlayers();
    if (active.length < 2) return;
    const firstHand = active[0].hand;
    for (let i = 0; i < active.length - 1; i++) {
      active[i].hand = active[i + 1].hand;
    }
    active[active.length - 1].hand = firstHand;

    active.forEach(p => {
      // emit hands after rotation is handled at gateway level via startRound
    });
  }

  private advanceTurn() {
    const active = this.activePlayers();
    this.currentTurnIndex = (this.currentTurnIndex + 1) % active.length;
  }

  private currentPlayer(): PlayerState {
    const active = this.activePlayers();
    return active[this.currentTurnIndex % active.length];
  }

  private activePlayers(): PlayerState[] {
    return this.players
      .filter(p => !p.isEliminated)
      .sort((a, b) => a.seat - b.seat);
  }

  private findPlayer(userId: string): PlayerState | undefined {
    return this.players.find(p => p.userId === userId);
  }

  private toPublicPlayer(p: PlayerState): PublicPlayerState {
    return {
      userId: p.userId,
      username: p.username,
      avatarIndex: p.avatarIndex,
      seat: p.seat,
      cardCount: p.hand.length,
      tokensLeft: p.tokensLeft,
      isConnected: p.isConnected,
      isEliminated: p.isEliminated,
      isReady: p.isReady,
    };
  }

  private fail(reason: string): EngineResult {
    return { success: false, reason, events: [] };
  }

  isGameOver(): boolean {
    return this.phase === 'GAME_OVER';
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  getMode(): GameMode {
    return this.mode;
  }

  currentTurnUserId(): string {
    return this.currentPlayer().userId;
  }

  computeBotMove(userId: string): { action: 'play'; cardIndices: number[] } | { action: 'pass'; insertAtIndex: number } {
    const player = this.findPlayer(userId);
    if (!player) return { action: 'pass', insertAtIndex: 0 };

    const hand = player.hand;

    // Group adjacent indices by value
    for (let start = 0; start < hand.length; start++) {
      const group: number[] = [start];
      for (let j = start + 1; j < hand.length; j++) {
        if (hand[j].value === hand[start].value) group.push(j);
        else break;
      }

      const validation = validatePlayIndices(
        hand,
        group,
        this.pile,
        this.saborActive,
        this.saborMinRequired,
      );

      if (validation.valid) return { action: 'play', cardIndices: group };
    }

    // No legal play — pass (insert drawn card at end of hand)
    return { action: 'pass', insertAtIndex: player.hand.length };
  }
}
