export type FoodCategory =
  | 'SUSHI'
  | 'RAMEN'
  | 'TACO'
  | 'PIZZA'
  | 'CURRY'
  | 'BURGER'
  | 'DESSERT';

export type GameMode =
  | 'TRADITIONAL'
  | 'MERCADO'
  | 'RODIZIO'
  | 'DEGUSTACAO';

export type RoomStatus =
  | 'WAITING'
  | 'STARTING'
  | 'IN_PROGRESS'
  | 'FINISHED';

export type GamePhase =
  | 'DEALING'
  | 'PLAYER_TURN'
  | 'PASS_PICK'
  | 'TRICK_PICK'
  | 'DUEL_PASS_PICK'
  | 'WIPE_RESOLUTION'
  | 'ROUND_END'
  | 'GAME_OVER';

export type PlayerRoomStatus = 'CONNECTED' | 'DISCONNECTED';

export interface Card {
  id: string;
  value: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  category: FoodCategory;
  variantIndex: number;
}

export interface PublicPlayerState {
  userId: string;
  username: string;
  avatarIndex: number;
  seat: number;
  cardCount: number;
  tokensLeft: number;
  isConnected: boolean;
  isEliminated: boolean;
  isReady: boolean;
}

export interface ClientGameState {
  roomCode: string;
  mode: GameMode;
  phase: GamePhase;
  round: number;
  currentTurnUserId: string;
  players: PublicPlayerState[];
  pile: Card[];
  drawPileCount: number;
  market: Card[] | null;
  saborActive: boolean;
  saborMinRequired: number;
  consecutivePasses: number;
  myHand: Card[];
  // Duelo: Pratos do Dia de cada jogador (chave = userId)
  duelPlates: Record<string, Card[]> | null;
  myDuelPlates: Card[] | null;
}

export interface GameRanking {
  userId: string;
  username: string;
  placement: number;
  tokensLeft: number;
}

export interface GameStats {
  totalRounds: number;
  saborTriggers: number;
  tricksWon: Record<string, number>;
}

export interface RoomPublicState {
  id: string;
  code: string;
  hostId: string;
  status: RoomStatus;
  mode: GameMode;
  maxPlayers: number;
  isPrivate: boolean;
  players: PublicPlayerState[];
}

export type LobbyErrorCode =
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'NOT_HOST'
  | 'ALREADY_STARTED'
  | 'NOT_ENOUGH_PLAYERS'
  | 'ALREADY_IN_ROOM';

export type GameErrorCode =
  | 'INVALID_PLAY'
  | 'NOT_YOUR_TURN'
  | 'TIMEOUT'
  | 'INVALID_INDICES'
  | 'INVALID_PICK';
