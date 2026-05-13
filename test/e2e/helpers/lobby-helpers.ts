import { TestWsClient } from './ws-client.js';

export function joinRoomWs(client: TestWsClient, roomCode: string): void {
  client.send('lobby:join_room', { roomCode });
}

export function setReadyWs(
  client: TestWsClient,
  roomCode: string,
  ready: boolean,
): void {
  client.send('lobby:set_ready', { roomCode, ready });
}

export function startGameWs(client: TestWsClient, roomCode: string): void {
  client.send('lobby:start_game', { roomCode });
}

export function leaveRoomWs(client: TestWsClient, roomCode: string): void {
  client.send('lobby:leave_room', { roomCode });
}

export function resetRoomWs(client: TestWsClient, roomCode: string): void {
  client.send('lobby:reset_room', { roomCode });
}
