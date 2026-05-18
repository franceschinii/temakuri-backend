import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.sub;
    if (!userId) throw new ForbiddenException();

    // Revalida isAdmin direto no banco — ignora o valor do JWT para evitar
    // que um admin removido continue com acesso durante o TTL do token (4h).
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) throw new ForbiddenException();
    return true;
  }
}
