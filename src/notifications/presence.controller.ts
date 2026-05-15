import { Controller, Get } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway.js';

/**
 * Endpoint REST publico que retorna o numero atual de usuarios online.
 * Existe porque o evento socket presence:count e enviado apenas no
 * handshake e em mudancas; componentes que montam depois do handshake
 * (ex: lobby ao navegar) perdem o valor inicial. Esse GET cobre o caso.
 */
@Controller('presence')
export class PresenceController {
  constructor(private readonly gateway: NotificationsGateway) {}

  @Get('online')
  getOnline() {
    return { online: this.gateway.getOnlineCount() };
  }
}
