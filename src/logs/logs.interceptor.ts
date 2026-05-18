import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { LogCategory, LogsService } from './logs.service.js';

/// Mapeia prefixos de rota para categorias. Rotas que nao casam com nenhum
/// prefixo nao sao logadas pelo interceptor (logs especificos sao gravados
/// manualmente via LogsService).
const ROUTE_CATEGORY_MAP: Array<{ prefix: string; category: LogCategory }> = [
  { prefix: '/auth', category: 'auth' },
  { prefix: '/admin', category: 'admin' },
  { prefix: '/payments', category: 'payment' },
  { prefix: '/shop', category: 'shop' },
];

/// Metodos HTTP que importa logar. GET de leitura nao gera log
/// (evita encher a tabela com GET /admin/users a cada refresh).
const LOGGED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/// Endpoints muito frequentes que nao trazem valor de auditoria.
const SKIP_PATHS = new Set([
  '/auth/refresh',
  '/auth/me',
]);

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
    if (SKIP_PATHS.has(pathOnly)) return next.handle();

    const matched = ROUTE_CATEGORY_MAP.find(m => pathOnly.startsWith(m.prefix));
    if (!matched) return next.handle();

    const userId = req?.user?.id ?? null;
    const username = req?.user?.username ?? null;
    const ip = (req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null) as string | null;
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
