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
  // True quando zera a mao na rodada atual. Resetado em startRound().
  // Quem esta out-of-round nao recebe turno e nao perde prato.
  isOutOfRound: boolean;
  isReady: boolean;
  isBot?: boolean;
  isGuest?: boolean;
  isAdmin?: boolean;
  level?: number;
  pds?: number;
  sessionWins?: number;
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
  private lastRoundWinnerId: string | null = null;
  private lastPlayerId: string | null = null;
  private mode: GameMode;
  private roomCode: string;
  private handBias: number;
  private turnTimer: NodeJS.Timeout | null = null;
  private saborTriggersThisGame = 0;
  private tricksWon: Record<string, number> = {};
  private pendingDraws: Map<string, Card> = new Map();
  private trickPileForPick: Card[] = [];
  private discardPile: Card[] = [];
  private isFirstTurn = false;
  // Modo Duelo (2 jogadores): Pratos do Dia por jogador
  private duelPlates: Map<string, Card[]> = new Map();
  private pendingDuelPick: string | null = null; // userId aguardando escolha de Prato do Dia
  // Contagem de passes por jogador na rodada atual (Duelo: 3 passes = derrota)
  private duelPassCount: Map<string, number> = new Map();

  private initialTokens: number;
  private integrityCheckEnabled = true;

  constructor(roomCode: string, mode: GameMode, handBias = 0, initialTokens = INITIAL_TOKENS) {
    this.roomCode = roomCode;
    this.mode = mode;
    this.handBias = handBias;
    this.initialTokens = initialTokens;
  }

  addPlayer(userId: string, username: string, avatarIndex: number, seat: number, meta?: { isBot?: boolean; isGuest?: boolean; isAdmin?: boolean; level?: number; pds?: number; sessionWins?: number }) {
    this.players.push({
      userId,
      username,
      avatarIndex,
      seat,
      hand: [],
      tokensLeft: this.initialTokens,
      isConnected: true,
      isEliminated: false,
      isOutOfRound: false,
      isReady: false,
      ...meta,
    });
    this.tricksWon[userId] = 0;
  }

  /**
   * @internal — testing only.
   * Substitui partes do estado interno do engine para cenários determinísticos
   * em testes unitários. Não use em código de produção.
   */
  _setStateForTest(state: {
    hands?: Record<string, Card[]>;
    deck?: Card[];
    pile?: Card[];
    duelPlates?: Record<string, Card[]>;
    tokens?: Record<string, number>;
  }): void {
    // Estado injetado raramente totaliza 63 cartas — desabilita o invariante
    this.integrityCheckEnabled = false;
    if (state.hands) {
      for (const [userId, hand] of Object.entries(state.hands)) {
        const player = this.players.find(p => p.userId === userId);
        if (player) player.hand = [...hand];
      }
    }
    if (state.deck !== undefined) this.drawPile = [...state.deck];
    if (state.pile !== undefined) this.pile = [...state.pile];
    if (state.duelPlates) {
      for (const [userId, plates] of Object.entries(state.duelPlates)) {
        this.duelPlates.set(userId, [...plates]);
      }
    }
    if (state.tokens) {
      for (const [userId, n] of Object.entries(state.tokens)) {
        const player = this.players.find(p => p.userId === userId);
        if (player) player.tokensLeft = n;
      }
    }
  }

  hasPlayer(userId: string): boolean {
    return this.players.some(p => p.userId === userId);
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
    this.trickPileForPick = [];
    this.saborActive = false;
    this.saborMinRequired = 0;
    this.consecutivePasses = 0;
    this.lastPlayerId = null;
    this.phase = 'DEALING';

    const activePlayers = this.activePlayers();
    // Limpa "fora da rodada" no inicio de cada rodada — todos os ativos voltam
    // a participar normalmente. isEliminated permanece (jogo todo).
    activePlayers.forEach(p => { p.isOutOfRound = false; });

    // Em RODIZIO, a partir da 2ª rodada as mãos já foram rotacionadas por
    // rotateHands() em resolveRoundEnd — não redistribuímos o baralho para
    // preservar o efeito da rotação.
    const deckRegenerated = !(this.mode === 'RODIZIO' && this.round > 1);
    if (deckRegenerated) {
      // Zera coleções residuais ANTES de redistribuir. buildDeck() gera
      // cartas com IDs determinísticos (`${value}-${variantIndex}`), então
      // cartas que sobraram no discardPile / pendingDraws da rodada
      // anterior compartilham IDs com o novo deck — sem este reset, a
      // checagem de integridade explode (duplicatas crescendo a cada rodada).
      this.discardPile = [];
      this.pendingDraws = new Map();
      this.duelPlates = new Map();
      this.duelPassCount = new Map();
      this.market = null;

      const { hands, drawPile } = dealCards(activePlayers.map(p => p.userId), this.handBias);
      activePlayers.forEach(p => { p.hand = hands.get(p.userId) ?? []; });
      this.drawPile = drawPile;
    }

    if (this.mode === 'MERCADO') {
      this.market = this.drawPile.splice(0, MARKET_SIZE);
    }

    // Modo Duelo: distribuir 2 Pratos do Dia abertos por jogador
    if (this.isDuel()) {
      this.duelPlates = new Map();
      this.duelPassCount = new Map();
      activePlayers.forEach(p => {
        const plates = this.drawPile.splice(0, 2);
        this.duelPlates.set(p.userId, plates);
        this.duelPassCount.set(p.userId, 0);
      });
    }

    // Prioridade: quem ganhou a rodada anterior comeca a proxima. Se nao
    // ha (primeira rodada do jogo), sorteia jogador inicial aleatorio.
    // lastWiperId so e usado como fallback intermediario (raro, mas mantemos
    // por seguranca caso resolveRoundEnd nao seja chamado).
    if (this.lastRoundWinnerId) {
      const idx = activePlayers.findIndex(p => p.userId === this.lastRoundWinnerId);
      this.currentTurnIndex = idx !== -1 ? idx : 0;
    } else if (this.lastWiperId) {
      const idx = activePlayers.findIndex(p => p.userId === this.lastWiperId);
      this.currentTurnIndex = idx !== -1 ? idx : 0;
    } else {
      // Primeira rodada: sorteio aleatorio entre os ativos.
      this.currentTurnIndex = Math.floor(Math.random() * activePlayers.length);
    }

    this.phase = 'PLAYER_TURN';
    this.isFirstTurn = true;

    const events: EngineEvent[] = [];

    activePlayers.forEach(p => {
      events.push({
        type: 'game:your_hand',
        payload: { hand: p.hand },
        targetUserId: p.userId,
      });
    });

    // Broadcast public round state so all clients stay in sync (pile reset, card counts)
    const cardCounts: Record<string, number> = {};
    activePlayers.forEach(p => { cardCounts[p.userId] = p.hand.length; });
    events.push({
      type: 'game:round_started',
      payload: {
        round: this.round,
        drawPileCount: this.isDuel() ? 0 : this.drawPile.length,
        cardCounts,
        duelPlates: this.isDuel() ? this.getDuelPlates() : null,
        market: this.market ?? null,
      },
    });

    events.push({
      type: 'game:turn_started',
      payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS },
    });

    return events;
  }

  applyPlayCards(userId: string, cardIndices: number[], plateIndices?: number[]): EngineResult {
    if (this.phase !== 'PLAYER_TURN') return this.fail('Not the right phase');
    if (this.currentPlayer().userId !== userId) return this.fail('Not your turn');
    if (this.findPlayer(userId)?.isOutOfRound) return this.fail('Você está fora desta rodada');

    const player = this.findPlayer(userId)!;

    // Resolve plate cards being combined with this play (Duelo only)
    let selectedPlateCards: Card[] | undefined;
    if (plateIndices && plateIndices.length > 0) {
      if (!this.isDuel()) return this.fail('Plate combination only available in Duel mode');
      const plates = this.duelPlates.get(userId) ?? [];
      if (plateIndices.some(i => i < 0 || i >= plates.length)) return this.fail('Invalid plate index');
      selectedPlateCards = plateIndices.map(i => plates[i]);
    }

    const validation = validatePlayIndices(
      player.hand,
      cardIndices,
      this.pile,
      this.saborActive,
      this.saborMinRequired,
      selectedPlateCards,
    );

    if (!validation.valid) return this.fail(validation.reason!);

    // Remove hand cards
    const sorted = [...cardIndices].sort((a, b) => a - b);
    const handPlayedCards = sorted.map(i => player.hand[i]);
    player.hand = player.hand.filter((_, i) => !sorted.includes(i));

    // Remove plates used in this play
    if (selectedPlateCards && plateIndices && plateIndices.length > 0) {
      const currentPlates = this.duelPlates.get(userId) ?? [];
      const remainingPlates = currentPlates.filter((_, i) => !plateIndices.includes(i));
      this.duelPlates.set(userId, remainingPlates);
    }

    const playedCards = selectedPlateCards
      ? [...handPlayedCards, ...selectedPlateCards]
      : handPlayedCards;

    const saborTriggered = isSabor(playedCards);
    // Pile anterior fica em previousPile — se houver, jogador entra em TRICK_PICK (regra A2)
    const previousPile = this.pile;
    this.pile = playedCards;
    this.consecutivePasses = 0;
    this.lastPlayerId = userId;
    this.isFirstTurn = false;

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

    const usedPlates = selectedPlateCards && selectedPlateCards.length > 0;
    // Sinaliza ao broadcast se o jogador vai entrar em TRICK_PICK depois desta jogada (regra A2),
    // para os outros clientes saberem que o turno NAO avancou ainda.
    const willEnterTrickPick = previousPile.length > 0 && player.hand.length > 0;
    events.push({
      type: 'game:cards_played',
      payload: {
        userId,
        cards: playedCards,
        isSabor: saborTriggered,
        usedPlates: usedPlates ? selectedPlateCards : undefined,
        remainingPlates: usedPlates ? (this.duelPlates.get(userId) ?? []) : undefined,
        nextPhase: willEnterTrickPick ? 'TRICK_PICK' : 'PLAYER_TURN',
      },
    });
    events.push({ type: 'game:your_hand', payload: { hand: player.hand }, targetUserId: userId });

    if (player.hand.length === 0) {
      // Jogador zerou a mao: SAI da rodada (escapa do prejuizo). NAO perde
      // prato. Pile anterior vai pro descarte automaticamente.
      player.isOutOfRound = true;
      if (previousPile.length > 0) this.discardPile.push(...previousPile);
      events.push({ type: 'game:player_hand_empty', payload: { userId } });
      const remainingInRound = this.playersInRound().length;
      events.push({
        type: 'game:player_out_of_round',
        payload: { userId, remainingInRound },
      });

      // Rodada acaba quando sobra 1 jogador com cartas — ele eh o perdedor
      // (perde 1 prato). Se sobra >= 2, continua avancando turno normalmente.
      if (remainingInRound <= 1) {
        const loser = this.playersInRound()[0];
        if (loser) {
          return { success: true, events: [...events, ...this.resolveRoundEnd(loser.userId)] };
        }
        // Edge case: zerou junto do ultimo restante (impossivel no fluxo
        // normal, mas defensivo). Trata como rodada sem perdedor — apenas
        // inicia proxima sem decrementar token de ninguem.
        this.lastWiperId = null;
        return { success: true, events: [...events, ...this.startRound()] };
      }

      // Sobra >= 2 jogadores em rodada: avanca turno pulando este (advanceTurn
      // ja pula isOutOfRound). Sem TRICK_PICK pois ele zerou a mao.
      this.advanceTurn();
      events.push({ type: 'game:turn_started', payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS } });
      this.assertCardIntegrity();
      return { success: true, events };
    }

    // Regra A2: se havia pile anterior, jogador escolhe pegar ou descartar antes do próximo turno
    if (previousPile.length > 0) {
      this.trickPileForPick = [...previousPile];
      this.phase = 'TRICK_PICK';
      events.push({
        type: 'game:trick_pick_offer',
        payload: { pile: this.trickPileForPick },
        targetUserId: userId,
      });
      this.assertCardIntegrity();
      return { success: true, events };
    }

    // Pile estava vazia: sem A2, só avança o turno
    this.advanceTurn();
    events.push({ type: 'game:turn_started', payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS } });

    this.assertCardIntegrity();
    return { success: true, events };
  }

  applyPassTurn(userId: string, insertAtIndex: number): EngineResult {
    if (this.phase !== 'PLAYER_TURN') return this.fail('Not the right phase');
    if (this.currentPlayer().userId !== userId) return this.fail('Not your turn');
    if (this.findPlayer(userId)?.isOutOfRound) return this.fail('Você está fora desta rodada');

    this.pendingDraws.delete(userId); // defensive: discard any stale pending draw

    const player = this.findPlayer(userId)!;

    if (insertAtIndex < 0 || insertAtIndex > player.hand.length) {
      return this.fail('insertAtIndex out of range');
    }

    // Draw from the finite deck (monte) — null if exhausted
    const drawnCard = this.drawPile.length > 0 ? this.drawPile.shift()! : null;

    if (drawnCard) {
      player.hand.splice(insertAtIndex, 0, drawnCard);
    }

    this.consecutivePasses++;

    const events: EngineEvent[] = [];
    events.push({
      type: 'game:turn_passed',
      payload: { userId, drawnCard, drawPileCount: this.isDuel() ? 0 : this.drawPile.length },
    });
    if (drawnCard) {
      events.push({ type: 'game:your_hand', payload: { hand: player.hand }, targetUserId: userId });
    }

    // Stalemate/wipe dispara quando todos OS QUE AINDA ESTAO NA RODADA
    // passaram. Filtrar por playersInRound evita falso-positivo quando
    // alguem ja saiu por zerar a mao.
    const inRound = this.playersInRound();
    if (this.consecutivePasses >= inRound.length - 1) {
      if (this.pile.length === 0) {
        const stalemate = this.resolveStalemate(inRound);
        this.assertCardIntegrity();
        return { success: true, events: [...events, ...stalemate] };
      }
      const wipeWinner = this.lastPlayerId ?? userId;
      const wipe = this.resolveWipe(wipeWinner);
      return { success: true, events: [...events, ...wipe] };
    }

    this.advanceTurn();
    events.push({ type: 'game:turn_started', payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS } });

    this.assertCardIntegrity();
    return { success: true, events };
  }

  applyDrawCard(userId: string): EngineResult {
    if (this.phase !== 'PLAYER_TURN') return this.fail('Not the right phase');
    if (this.currentPlayer().userId !== userId) return this.fail('Not your turn');
    if (this.findPlayer(userId)?.isOutOfRound) return this.fail('Você está fora desta rodada');

    if (this.isFirstTurn) {
      return this.fail('No primeiro turno você é obrigado a jogar cartas');
    }

    // Modo Duelo: passar = escolher um Prato do Dia, não comprar do monte
    if (this.isDuel()) {
      const plates = this.duelPlates.get(userId) ?? [];
      if (plates.length === 0) {
        // Sem Pratos do Dia → perde imediatamente
        return { success: true, events: this.resolveDuelLoss(userId) };
      }
      this.pendingDuelPick = userId;
      this.phase = 'DUEL_PASS_PICK';
      return {
        success: true,
        events: [{
          type: 'game:duel_pass_offer',
          payload: { plates },
          targetUserId: userId,
        }],
      };
    }

    // Deck exhausted: resolve immediately as a pass with no card
    if (this.drawPile.length === 0) {
      return this.applyPassTurn(userId, 0);
    }

    const card = this.drawPile.shift()!;
    this.pendingDraws.set(userId, card);
    this.phase = 'PASS_PICK';

    return {
      success: true,
      events: [{
        type: 'game:card_drawn',
        payload: { card, drawPileCount: this.drawPile.length },
        targetUserId: userId,
      }],
    };
  }

  // Modo Duelo: jogador escolhe um Prato do Dia para colocar na mão ou descartar
  applyDuelPassPick(userId: string, plateIndex: number, action: 'insert' | 'discard', insertAtIndex = 0): EngineResult {
    if (this.phase !== 'DUEL_PASS_PICK') return this.fail('Not in duel pass pick phase');
    if (this.pendingDuelPick !== userId) return this.fail('Not your turn');

    const plates = this.duelPlates.get(userId) ?? [];
    if (plateIndex < 0 || plateIndex >= plates.length) return this.fail('Invalid plate index');

    const pickedPlate = plates[plateIndex];

    if (action === 'insert') {
      const player = this.findPlayer(userId)!;
      if (insertAtIndex < 0 || insertAtIndex > player.hand.length) {
        return this.fail('insertAtIndex out of range');
      }
    }

    const remainingPlates = plates.filter((_, i) => i !== plateIndex);
    this.duelPlates.set(userId, remainingPlates);
    this.pendingDuelPick = null;
    this.phase = 'PLAYER_TURN';

    const player = this.findPlayer(userId)!;
    const events: EngineEvent[] = [];

    if (action === 'insert') {
      player.hand.splice(insertAtIndex, 0, pickedPlate);
      events.push({ type: 'game:your_hand', payload: { hand: player.hand }, targetUserId: userId });
    } else {
      this.discardPile.push(pickedPlate);
    }

    // Duelo usa duelPassCount por jogador — consecutivePasses global causaria
    // término prematuro da rodada (resolveWipe/Stalemate dispara quando atinge
    // activePlayers.length - 1, que em duelo é 1).
    const passCount = (this.duelPassCount.get(userId) ?? 0) + 1;
    this.duelPassCount.set(userId, passCount);

    events.push({
      type: 'game:duel_plate_used',
      payload: { userId, plateIndex, action, remainingPlates, drawnCard: action === 'insert' ? pickedPlate : null, duelPassCount: passCount },
    });

    if (passCount >= 3) {
      return { success: true, events: [...events, ...this.resolveRoundEnd(userId)] };
    }

    this.advanceTurn();
    events.push({ type: 'game:turn_started', payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS } });
    return { success: true, events };
  }

  private resolveStalemate(playersInRoundList: PlayerState[]): EngineEvent[] {
    // Todos os jogadores ainda EM rodada passaram sem ninguem jogar —
    // quem tem mais cartas na mao perde. Em empate, perde quem tem o
    // maior seat (criterio deterministico).
    const loser = playersInRoundList.reduce((worst, p) => {
      if (p.hand.length > worst.hand.length) return p;
      if (p.hand.length === worst.hand.length && p.seat > worst.seat) return p;
      return worst;
    });
    return this.resolveRoundEnd(loser.userId);
  }

  private resolveDuelLoss(loserId: string): EngineEvent[] {
    // Sem Pratos do Dia → perde a batalha imediatamente (perde 1 token, rodada encerra)
    return this.resolveRoundEnd(loserId);
  }

  isDuel(): boolean {
    return this.activePlayers().length === 2;
  }

  getDuelPlates(): Record<string, Card[]> {
    const result: Record<string, Card[]> = {};
    this.duelPlates.forEach((plates, userId) => { result[userId] = plates; });
    return result;
  }

  applyInsertDrawn(userId: string, insertAtIndex: number, action: 'insert' | 'discard' = 'insert'): EngineResult {
    if (this.phase !== 'PASS_PICK') {
      // Defensive: limpa pending draw para evitar vazamento se a fase já tiver mudado
      this.pendingDraws.delete(userId);
      return this.fail('Not in pick phase');
    }
    if (this.currentPlayer().userId !== userId) return this.fail('Not your turn');
    if (this.findPlayer(userId)?.isOutOfRound) return this.fail('Você está fora desta rodada');

    const drawnCard = this.pendingDraws.get(userId) ?? null;

    if (action === 'insert' && drawnCard) {
      const player = this.findPlayer(userId)!;
      if (insertAtIndex < 0 || insertAtIndex > player.hand.length) {
        return this.fail('insertAtIndex out of range');
      }
    }

    this.pendingDraws.delete(userId);
    this.phase = 'PLAYER_TURN';

    const player = this.findPlayer(userId)!;
    let cardAddedToHand = false;

    if (action === 'insert' && drawnCard) {
      player.hand.splice(insertAtIndex, 0, drawnCard);
      cardAddedToHand = true;
    }
    // 'discard': drawnCard vai para o descarte
    if (action === 'discard' && drawnCard) {
      this.discardPile.push(drawnCard);
    }

    this.consecutivePasses++;

    const events: EngineEvent[] = [];
    events.push({
      type: 'game:turn_passed',
      payload: {
        userId,
        drawnCard: cardAddedToHand ? drawnCard : null,
        discardedCard: !cardAddedToHand && drawnCard ? drawnCard : null,
        drawPileCount: this.isDuel() ? 0 : this.drawPile.length,
      },
    });
    if (cardAddedToHand) {
      events.push({ type: 'game:your_hand', payload: { hand: player.hand }, targetUserId: userId });
    }

    const inRound = this.playersInRound();
    if (this.consecutivePasses >= inRound.length - 1) {
      if (this.pile.length === 0) {
        const stalemate = this.resolveStalemate(inRound);
        this.assertCardIntegrity();
        return { success: true, events: [...events, ...stalemate] };
      }
      const wipeWinner = this.lastPlayerId ?? userId;
      const wipe = this.resolveWipe(wipeWinner);
      return { success: true, events: [...events, ...wipe] };
    }

    this.advanceTurn();
    events.push({ type: 'game:turn_started', payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS } });

    this.assertCardIntegrity();
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

  /**
   * Jogador abandonou a partida em andamento. Tratado como derrota: vira
   * eliminado (igual a perder todos os pratos). A mao dele vai pro
   * descarte. Se era a vez dele, o turno avanca. Se a saida deixa <= 1
   * jogador ativo, o jogo termina. Se deixa exatamente 1 jogador EM
   * rodada (mas ainda ha >= 2 no jogo), encerra a rodada com esse como
   * perdedor. Retorna os eventos resultantes (pode incluir game_over).
   */
  removePlayerFromGame(userId: string): EngineEvent[] {
    const p = this.findPlayer(userId);
    if (!p || p.isEliminated) return [];

    // Se era o jogador da vez, precisamos avancar o turno DEPOIS de
    // marca-lo eliminado. Guarda se era a vez dele.
    const wasCurrent =
      this.phase === 'PLAYER_TURN' && this.currentPlayer()?.userId === userId;

    // Devolve a mao ao descarte (integridade: cartas nao podem sumir).
    if (p.hand.length > 0) {
      this.discardPile.push(...p.hand);
      p.hand = [];
    }
    p.isEliminated = true;
    p.isOutOfRound = true;
    p.tokensLeft = 0;
    this.pendingDraws.delete(userId);

    const events: EngineEvent[] = [
      { type: 'game:player_left', payload: { userId } },
    ];

    const active = this.activePlayers();

    // Sobrou 0 ou 1 jogador no jogo todo → fim de jogo. O ultimo
    // (se houver) eh o vencedor; o que saiu eh o perdedor.
    if (active.length <= 1) {
      // resolveGameOver espera o loserId. O que saiu eh o perdedor.
      return [...events, ...this.resolveGameOver(userId)];
    }

    // Ainda ha >= 2 ativos. Se o que saiu travou a vez, ou se agora so
    // resta 1 jogador EM rodada (os outros ja zeraram a mao), resolve.
    const inRound = this.playersInRound();
    if (inRound.length <= 1) {
      const loser = inRound[0];
      if (loser) {
        return [...events, ...this.resolveRoundEnd(loser.userId)];
      }
      // Ninguem em rodada (todos zeraram / sairam) — comeca proxima.
      this.lastWiperId = null;
      return [...events, ...this.startRound()];
    }

    // Jogo continua. Se era a vez do que saiu, avanca o turno.
    if (wasCurrent && this.phase === 'PLAYER_TURN') {
      // Se o que saiu estava com a pile na mesa (lastPlayerId), limpa
      // pra nao deixar pile orfa bloqueando a proxima jogada.
      this.advanceTurn();
      events.push({
        type: 'game:turn_started',
        payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS },
      });
    }

    this.assertCardIntegrity();
    return events;
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
      drawPileCount: this.isDuel() ? 0 : this.drawPile.length,
      discardPileCount: this.discardPile.length,
      market: this.market,
      saborActive: this.saborActive,
      saborMinRequired: this.saborMinRequired,
      consecutivePasses: this.consecutivePasses,
      myHand: this.findPlayer(userId)?.hand ?? [],
      duelPlates: this.isDuel() ? this.getDuelPlates() : null,
      myDuelPlates: this.isDuel() ? (this.duelPlates.get(userId) ?? null) : null,
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
    // Regra: quando todos passam, a pile vai pro descarte automaticamente
    // e o último jogador (wiper) vira inicial com área vazia.
    const wiper = this.findPlayer(wiperId);

    // Se o wiper zerou a mao (out-of-round), o turno NAO pode voltar pra
    // ele — travaria (ele nao pode jogar/passar). Passa o turno pro
    // proximo jogador ainda em rodada, em ordem de seat a partir do wiper.
    let effectiveStarterId = wiperId;
    if (!wiper || wiper.isOutOfRound) {
      const active = this.activePlayers();
      const wiperIdx = active.findIndex(p => p.userId === wiperId);
      const startFrom = wiperIdx >= 0 ? wiperIdx : 0;
      for (let i = 1; i <= active.length; i++) {
        const cand = active[(startFrom + i) % active.length];
        if (cand && !cand.isOutOfRound) { effectiveStarterId = cand.userId; break; }
      }
    }

    this.lastWiperId = effectiveStarterId;
    this.tricksWon[wiperId] = (this.tricksWon[wiperId] ?? 0) + 1;
    this.consecutivePasses = 0;
    this.saborActive = false;
    this.saborMinRequired = 0;

    const wipedCount = this.pile.length;
    if (this.pile.length > 0) this.discardPile.push(...this.pile);
    this.pile = [];

    const starterIndex = this.activePlayers().findIndex(p => p.userId === effectiveStarterId);
    this.currentTurnIndex = starterIndex >= 0 ? starterIndex : 0;
    this.phase = 'PLAYER_TURN';

    this.assertCardIntegrity();
    return [
      // winnerId mantem o wiper real (quem ganhou a vaza) pro log/animacao.
      { type: 'game:wipe', payload: { winnerId: wiperId, pileCount: wipedCount } },
      { type: 'game:turn_started', payload: { userId: effectiveStarterId, timeoutMs: TURN_TIMEOUT_MS } },
    ];
  }

  applyTrickPick(userId: string, action: 'take' | 'discard', insertAtIndex = 0): EngineResult {
    if (this.phase !== 'TRICK_PICK') return this.fail('Not in trick pick phase');
    if (this.currentPlayer().userId !== userId) return this.fail('Not your turn');
    if (this.findPlayer(userId)?.isOutOfRound) return this.fail('Você está fora desta rodada');

    const events: EngineEvent[] = [];
    const player = this.findPlayer(userId)!;

    const resolvedCards = [...this.trickPileForPick];

    if (action === 'take') {
      if (insertAtIndex < 0 || insertAtIndex > player.hand.length) {
        return this.fail('insertAtIndex out of range');
      }
      player.hand.splice(insertAtIndex, 0, ...resolvedCards);
      events.push({ type: 'game:your_hand', payload: { hand: player.hand }, targetUserId: userId });
    } else {
      this.discardPile.push(...resolvedCards);
    }

    this.trickPileForPick = [];
    this.phase = 'PLAYER_TURN';

    // Avanca turno ANTES de emitir trick_pick_result, para incluir nextTurnUserId no payload.
    // Isso permite ao frontend sincronizar mesmo se o game:turn_started for perdido.
    this.advanceTurn();
    const nextUserId = this.currentPlayer().userId;

    events.push({
      type: 'game:trick_pick_result',
      payload: {
        userId,
        action,
        discardedCards: action === 'discard' ? resolvedCards : [],
        takenCount: action === 'take' ? resolvedCards.length : 0,
        nextTurnUserId: nextUserId,
      },
    });
    events.push({ type: 'game:turn_started', payload: { userId: nextUserId, timeoutMs: TURN_TIMEOUT_MS } });

    this.assertCardIntegrity();
    return { success: true, events };
  }

  getTrickPileForPick(): Card[] { return this.trickPileForPick; }

  /**
   * Encerra a rodada decrementando 1 prato do PERDEDOR (quem ficou com
   * cartas na mao por ultimo, ou quem causou o stalemate/duel loss).
   * Se o perdedor chega a 0 pratos, eh ELIMINADO do jogo e o jogo termina.
   */
  private resolveRoundEnd(loserId: string): EngineEvent[] {
    this.phase = 'ROUND_END';

    const loser = this.findPlayer(loserId);
    if (loser) {
      loser.tokensLeft = Math.max(0, loser.tokensLeft - 1);
    }

    const playerTokens: Record<string, number> = {};
    this.players.forEach(p => { playerTokens[p.userId] = p.tokensLeft; });

    const events: EngineEvent[] = [{
      type: 'game:round_ended',
      // loserId (novo, singular) eh a fonte de verdade. loserIds (array)
      // mantido por compatibilidade com clientes antigos durante o deploy.
      payload: { loserId, loserIds: [loserId], playerTokens },
    }];

    if (loser && loser.tokensLeft === 0) {
      loser.isEliminated = true;
      return [...events, ...this.resolveGameOver(loserId)];
    }

    if (this.mode === 'RODIZIO') {
      this.rotateHands();
    }

    // Quem perdeu a rodada inicia a proxima (mantem o seed determinístico
    // — antes era "vencedor", agora eh "perdedor", mas a propriedade
    // "alguem especifico abre a proxima" continua existindo).
    this.lastRoundWinnerId = loserId;
    this.lastWiperId = null;
    return [...events, ...this.startRound()];
  }

  /**
   * Fim de jogo: o loserId chegou a 0 pratos. Ele eh o UNICO perdedor.
   * Todos os outros sao vencedores (isWinner=true). Ordenacao do ranking:
   * vencedores primeiro (mais pratos = melhor), tiebreaker por seat
   * crescente. loser sempre por ultimo.
   */
  private resolveGameOver(loserId: string): EngineEvent[] {
    this.phase = 'GAME_OVER';

    const sorted = [...this.players].sort((a, b) => {
      if (a.userId === loserId) return 1;  // loser sempre ultimo
      if (b.userId === loserId) return -1;
      if (b.tokensLeft !== a.tokensLeft) return b.tokensLeft - a.tokensLeft;
      return a.seat - b.seat;
    });
    const rankings: GameRanking[] = sorted.map((p, i) => ({
      userId: p.userId,
      username: p.username,
      placement: i + 1,
      tokensLeft: p.tokensLeft,
      isWinner: p.userId !== loserId,
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
    if (active.length === 0) return;
    // Avanca circularmente pulando jogadores out-of-round. Garantido que
    // sobra ao menos 1 jogador em rodada (a checagem de fim de rodada
    // dispara antes de chegarmos aqui se sobrasse so 1).
    for (let i = 0; i < active.length; i++) {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % active.length;
      if (!active[this.currentTurnIndex].isOutOfRound) return;
    }
    // Fallback defensivo: se todos estao out (nao deveria), fica no atual.
  }

  /**
   * Invariante: o deck tem exatamente 63 cartas, 9 de cada valor (1-7), IDs únicos.
   * Soma todas as cartas em qualquer local rastreável (mãos, pile, drawPile, discardPile,
   * market, plates de duelo, draws pendentes, trickPileForPick) e valida.
   * Falha silenciosa em prod (log), throw em dev/test via NODE_ENV.
   */
  private assertCardIntegrity(): void {
    if (!this.integrityCheckEnabled) return;
    const all: Card[] = [
      ...this.pile,
      ...this.drawPile,
      ...this.discardPile,
      ...this.trickPileForPick,
      ...this.players.flatMap(p => p.hand),
      ...(this.market ?? []),
      ...Array.from(this.duelPlates.values()).flat(),
      ...Array.from(this.pendingDraws.values()),
    ];
    const ids = new Set(all.map(c => c.id));
    const countsByValue = new Map<number, number>();
    for (const c of all) countsByValue.set(c.value, (countsByValue.get(c.value) ?? 0) + 1);

    const problems: string[] = [];
    if (all.length !== 63) problems.push(`total ${all.length}/63`);
    if (ids.size !== all.length) problems.push(`duplicates: ${all.length - ids.size}`);
    for (const v of [1, 2, 3, 4, 5, 6, 7]) {
      const c = countsByValue.get(v) ?? 0;
      if (c !== 9) problems.push(`value ${v}: ${c}/9`);
    }

    if (problems.length > 0) {
      const msg = `[GameEngine] Card integrity broken (room ${this.roomCode}): ${problems.join(', ')}`;
      // Em test queremos throw pra falhar a suite. Em dev/prod só logamos —
      // throw mata o processo Node inteiro e quebra a sala pra todos. É
      // melhor degradar continuando com state inconsistente e deixar o
      // cliente pedir resync via game:request_state.
      if (process.env.NODE_ENV === 'test') {
        throw new Error(msg);
      }
      console.error(msg);
    }
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

  /**
   * Subset de activePlayers que ainda esta jogando NA rodada atual
   * (nao eliminado do jogo E nao saiu da rodada por zerar a mao).
   * Usado em advanceTurn, deteccao de fim de rodada, contagem de passes
   * consecutivos, stalemate.
   */
  private playersInRound(): PlayerState[] {
    return this.activePlayers().filter(p => !p.isOutOfRound);
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
      isOutOfRound: p.isOutOfRound,
      isReady: p.isReady,
      isBot: p.isBot,
      isGuest: p.isGuest,
      isAdmin: p.isAdmin,
      level: p.level,
      pds: p.pds,
      sessionWins: p.sessionWins,
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

  isUserOutOfRound(userId: string): boolean {
    return this.findPlayer(userId)?.isOutOfRound === true;
  }

  getHumanPlayerIds(): string[] {
    return this.activePlayers()
      .filter(p => !p.isBot)
      .map(p => p.userId);
  }

  /**
   * Recuperacao defensiva: se o turno atual aponta pra um jogador
   * out-of-round (nao deveria acontecer com a logica nova, mas blinda
   * contra travamento), avanca o turno pro proximo valido e retorna o
   * evento turn_started. Retorna [] se nao precisou corrigir.
   */
  recoverStuckTurn(): EngineEvent[] {
    if (this.phase !== 'PLAYER_TURN') return [];
    const cur = this.currentPlayer();
    if (!cur || !cur.isOutOfRound) return [];
    // Se sobrou so 1 em rodada, encerra a rodada com ele como perdedor.
    const inRound = this.playersInRound();
    if (inRound.length <= 1) {
      const loser = inRound[0];
      if (loser) return this.resolveRoundEnd(loser.userId);
      this.lastWiperId = null;
      return this.startRound();
    }
    this.advanceTurn();
    return [{ type: 'game:turn_started', payload: { userId: this.currentPlayer().userId, timeoutMs: TURN_TIMEOUT_MS } }];
  }

  /**
   * Calcula uma jogada para um bot. A heuristica varia por dificuldade:
   *
   * - easy: primeiro grupo adjacente legal de mesmo valor. Sem estrategia.
   *
   * - medium: maior grupo legal; empate de tamanho resolvido por maior valor.
   *   Nunca passa voluntariamente — joga agressivo.
   *
   * - hard: mesmo criterio de selecao do medium, mais:
   *   - End-game (<=3 cartas na mao): sempre joga, sem esperar combo.
   *   - Pressao (oponente com <=2 cartas): sempre joga para nao deixar fechar.
   *   - Passe estrategico: so quando best.size==1 E pilha calma (<=3) E
   *     mao grande (>=5) E sem sabor E ha duplicatas nao-adjacentes montaveis.
   *
   * Default (bots sem difficulty definida) = easy.
   */
  computeBotMove(
    userId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'easy',
  ): { action: 'play'; cardIndices: number[] } | { action: 'pass'; insertAtIndex: number } {
    const player = this.findPlayer(userId);
    if (!player) return { action: 'pass', insertAtIndex: 0 };

    const hand = player.hand;

    // Enumera todos os grupos adjacentes de mesmo valor que sao legais.
    const legalGroups: { indices: number[]; value: number; size: number }[] = [];
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
      if (validation.valid) {
        legalGroups.push({ indices: group, value: hand[start].value, size: group.length });
      }
    }

    if (legalGroups.length === 0) {
      return { action: 'pass', insertAtIndex: hand.length };
    }

    if (difficulty === 'easy') {
      return { action: 'play', cardIndices: legalGroups[0].indices };
    }

    // medium e hard: maior grupo; empate de tamanho resolvido por maior valor.
    let best = legalGroups[0];
    for (const g of legalGroups) {
      if (g.size > best.size || (g.size === best.size && g.value > best.value)) best = g;
    }

    if (difficulty === 'medium') {
      return { action: 'play', cardIndices: best.indices };
    }

    // --- hard ---
    // Agressivo: sempre joga o melhor grupo. Sem passe estrategico —
    // reduzir a mao e sempre melhor do que guardar cartas para combo.

    // Pressao maxima no final: qualquer oponente com <= 3 cartas → prioridade absoluta.
    const activeOpponents = this.activePlayers().filter(p => p.userId !== userId && !p.isOutOfRound);
    if (hand.length <= 4 || activeOpponents.some(p => p.hand.length <= 3)) {
      return { action: 'play', cardIndices: best.indices };
    }

    return { action: 'play', cardIndices: best.indices };
  }
}
