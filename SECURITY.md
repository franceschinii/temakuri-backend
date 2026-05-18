# Política de Segurança

## Versões suportadas

Apenas a versão mais recente em `main` recebe correções de segurança.

## Reportando uma vulnerabilidade

**Não abra uma issue pública para vulnerabilidades de segurança.**

Envie um e-mail para **contato@andrefranceschini.com.br** com:

- Descrição da vulnerabilidade
- Endpoint ou componente afetado
- Passos para reproduzir
- Impacto potencial (escalonamento de privilégio, vazamento de dados, etc.)
- Sugestão de correção (opcional)

Você receberá uma resposta em até 72 horas. Após a correção ser publicada, a vulnerabilidade pode ser divulgada publicamente com crédito ao descobridor, se desejado.

## Escopo

Vulnerabilidades críticas a reportar:

- SQL Injection ou acesso não autorizado ao banco
- Bypass de autenticação JWT
- Validação incorreta de assinatura de webhook (pagamentos)
- Escalada de privilégio (usuário comum acessando rotas de admin)
- Manipulação de estado do jogo via WebSocket sem validação servidor
- Exposição de dados pessoais de outros usuários

## O que não é vulnerabilidade

- Cheating no jogo que só afeta a própria partida do usuário
- Bugs de lógica de jogo sem impacto de segurança
- Ausência de rate limiting em endpoints de baixo risco
- Funcionalidades intencionais documentadas

## Boas práticas para contribuidores

- Nunca commite `.env`, secrets ou credenciais reais
- Todas as env vars sensíveis ficam em `.env` (excluído do git)
- Validação de entrada em todos os DTOs via `class-validator`
- Assinatura de webhook verificada com timing-safe compare (`crypto.timingSafeEqual`)
- JWT verificado no servidor — nunca confie em dados do cliente
