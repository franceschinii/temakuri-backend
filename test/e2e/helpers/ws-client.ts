import WebSocket from 'ws';

type EventHandler = (data: any) => void;

export interface TestWsClientOptions {
  defaultTimeoutMs?: number;
}

export class TestWsClient {
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<EventHandler>>();
  public events: Map<string, any[]> = new Map();
  public readonly defaultTimeoutMs: number;

  constructor(opts: TestWsClientOptions = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 5000;
  }

  async connect(url: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sep = url.includes('?') ? '&' : '?';
      this.socket = new WebSocket(`${url}${sep}token=${encodeURIComponent(token)}`);

      const onOpen = () => {
        this.socket!.off('error', onError);
        this.socket!.off('close', onClose);
        resolve();
      };
      const onError = (err: Error) => {
        this.socket!.off('open', onOpen);
        this.socket!.off('close', onClose);
        reject(err);
      };
      const onClose = (code: number, reason: Buffer) => {
        this.socket!.off('open', onOpen);
        this.socket!.off('error', onError);
        reject(new Error(`Socket closed before open (code=${code}, reason=${reason.toString()})`));
      };
      this.socket.once('open', onOpen);
      this.socket.once('error', onError);
      this.socket.once('close', onClose);

      this.socket.on('message', (raw: Buffer) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const event: string = parsed.event;
        const data = parsed.data ?? parsed.payload ?? parsed;
        if (!event) return;
        if (!this.events.has(event)) this.events.set(event, []);
        this.events.get(event)!.push(data);
        const set = this.listeners.get(event);
        if (set) {
          for (const fn of set) fn(data);
        }
      });
    });
  }

  send(event: string, data: any = {}): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot send '${event}': socket not open`);
    }
    this.socket.send(JSON.stringify({ event, data }));
  }

  async waitFor<T = any>(event: string, timeoutMs?: number): Promise<T> {
    const limit = timeoutMs ?? this.defaultTimeoutMs;
    const buffered = this.events.get(event);
    if (buffered && buffered.length > 0) return buffered[0] as T;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`waitFor('${event}') timeout after ${limit}ms`));
      }, limit);
      const handler: EventHandler = (data) => {
        clearTimeout(timer);
        this.off(event, handler);
        resolve(data as T);
      };
      this.on(event, handler);
    });
  }

  async waitForState<T = any>(
    predicate: (state: T) => boolean,
    timeoutMs?: number,
  ): Promise<T> {
    const limit = timeoutMs ?? this.defaultTimeoutMs;
    const event = 'game:state_sync';
    const buffered = this.events.get(event);
    if (buffered) {
      for (const state of buffered) {
        if (predicate(state as T)) return state as T;
      }
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`waitForState() timeout after ${limit}ms`));
      }, limit);
      const handler: EventHandler = (data) => {
        if (predicate(data as T)) {
          clearTimeout(timer);
          this.off(event, handler);
          resolve(data as T);
        }
      };
      this.on(event, handler);
    });
  }

  private on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  private off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  clearEvents(): void {
    this.events.clear();
  }

  close(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;
    this.listeners.clear();
  }
}
