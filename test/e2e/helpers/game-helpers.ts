import { INestApplication } from '@nestjs/common';
import { TestWsClient } from './ws-client.js';
import { createRoom, addBot } from './room-helpers.js';
import { joinRoomWs, setReadyWs, startGameWs } from './lobby-helpers.js';

type GameMode = 'TRADITIONAL' | 'MERCADO' | 'RODIZIO' | 'DEGUSTACAO';

export interface StartGameOpts {
  mode?: GameMode;
  maxPlayers?: number;
  isRanked?: boolean;
  /** Quantos bots adicionar; default = maxPlayers - 1 */
  botCount?: number;
}

export interface GameStartResult {
  client: TestWsClient;
  roomCode: string;
}

/**
 * Fluxo padrão: cria sala → adiciona bots → conecta humano → join → ready →
 * start → aguarda primeiro game:turn_started.
 */
export async function startGameWithBots(
  app: INestApplication,
  wsUrl: string,
  token: string,
  opts: StartGameOpts = {},
): Promise<GameStartResult> {
  const maxPlayers = opts.maxPlayers ?? 4;
  const botCount = opts.botCount ?? maxPlayers - 1;
  const room = await createRoom(app, token, {
    mode: opts.mode ?? 'TRADITIONAL',
    maxPlayers,
    isRanked: opts.isRanked ?? false,
  });
  for (let i = 0; i < botCount; i++) {
    await addBot(app, token, room.code);
  }
  const client = new TestWsClient({ defaultTimeoutMs: 15000 });
  await client.connect(wsUrl, token);
  joinRoomWs(client, room.code);
  await client.waitFor('lobby:room_updated', 5000);
  setReadyWs(client, room.code, true);
  await new Promise((r) => setTimeout(r, 100));
  startGameWs(client, room.code);
  await client.waitFor('game:turn_started', 8000);
  return { client, roomCode: room.code };
}

export interface GameOverSummary {
  rankings: Array<{
    userId: string;
    username: string;
    placement: number;
    tokensLeft: number;
  }>;
  room: any;
  rewards: Record<
    string,
    {
      xpEarned: number;
      coinsEarned: number;
      newLevel: number;
      leveledUp: boolean;
      pdsChange: number;
      newPds: number;
      newRank: string;
    }
  >;
}

/**
 * Aguarda o evento emitido APÓS `markFinished` persistir no DB.
 * Use isso (não `game:game_over`) quando for verificar estado no banco.
 */
export async function awaitGameOverSummary(
  client: TestWsClient,
  timeoutMs = 60000,
): Promise<GameOverSummary> {
  return client.waitFor<GameOverSummary>('lobby:game_over_summary', timeoutMs);
}
