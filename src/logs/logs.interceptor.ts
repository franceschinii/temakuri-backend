import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { LogCategory, LogsService } from './logs.service.js';

/// Mapeia segmentos de rota para categorias. O matching procura o segmento
/// em qualquer posicao do path, ignorando prefixos como /api/v1.
const ROUTE_CATEGORY_MAP: Array<{ segment: string; category: LogCategory }> = [
  { segment: 'auth', category: 'auth' },
  { segment: 'admin', category: 'admin' },
  { segment: 'payments', category: 'payment' },
  { segment: 'shop', category: 'shop' },
];

/// Metodos HTTP que importa logar. GET de leitura nao gera log
/// (evita encher a tabela com GET /admin/users a cada refresh).
const LOGGED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/// Sufixos de path (ignorando prefixo /api/vN) que nao trazem valor de auditoria.
const SKIP_SUFFIXES = ['/auth/refresh', '/auth/me'];

@Injectable()
export class LogsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LogsInterceptor.name);

  constructor(private readonly logs: LogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<any>();
    const res = http.getResponse<any>();

    const method: string = req?.method ?? '';
    const url: string = req?.originalUrl ?? req?.url ?? '';
    const pathOnly = url.split('?')[0];

    if (!LOGGED_METHODS.has(method)) return next.handle();
    if (SKIP_SUFFIXES.some(s => pathOnly.endsWith(s))) return next.handle();

    // Procura o primeiro segmento conhecido em qualquer posicao do path.
    // Tolera prefixos globais como /api/v1.
    const segments = pathOnly.split('/').filter(Boolean);
    const matched = ROUTE_CATEGORY_MAP.find(m => segments.includes(m.segment));
    if (!matched) return next.handle();

    const userId = req?.user?.id ?? null;
    const username = req?.user?.username ?? null;
    // X-Forwarded-For pode vir como "ip1, ip2, ip3" (cadeia de proxies). O
     // primeiro e o cliente original; os seguintes sao os proxies. Com
     // trust proxy=1, req.ip ja resolve corretamente, mas preferimos o
     // header explicito caso haja mais de um hop.
    const xff = req?.headers?.['x-forwarded-for'];
    const xffFirst = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff.split(',')[0]?.trim() : null);
    const ip = (xffFirst || req?.ip || null) as string | null;
    const action = this.deriveAction(method, pathOnly);

    return next.handle().pipe(
      tap(() => {
        const statusCode: number | null = res?.statusCode ?? null;
        void this.logs.record({
          category: matched.category,
          action,
          level: 'info',
          userId,
          username,
          ip,
          statusCode,
          metadata: this.safeBody(req?.body),
        });
      }),
      catchError(err => {
        const status: number = err?.status ?? err?.statusCode ?? 500;
        void this.logs.record({
          category: matched.category,
          action,
          level: status >= 500 ? 'error' : 'warn',
          userId,
          username,
          ip,
          statusCode: status,
          metadata: {
            error: err?.message,
            body: this.safeBody(req?.body),
          },
        });
        return throwError(() => err);
      }),
    );
  }

  /// Converte path em uma acao legivel: POST /admin/users/abc/credit-diamonds
  /// vira "post /admin/users/:id/credit-diamonds". Substitui IDs (segmentos
  /// alfanumericos longos) por :id para agrupar logs do mesmo endpoint.
  private deriveAction(method: string, path: string): string {
    const normalized = path
      .split('/')
      .map(seg => {
        if (!seg) return seg;
        // Substitui cuids (24+ chars) e UUIDs por :id
        if (/^[a-z0-9]{20,}$/i.test(seg)) return ':id';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
        return seg;
      })
      .join('/');
    return `${method.toLowerCase()} ${normalized}`;
  }

  /// Remove campos sensiveis antes de gravar.
  private safeBody(body: unknown): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const SENSITIVE = ['password', 'newPassword', 'oldPassword', 'token', 'refreshToken'];
    const clone: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      clone[k] = SENSITIVE.includes(k) ? '[redacted]' : v;
    }
    return clone;
  }
}
