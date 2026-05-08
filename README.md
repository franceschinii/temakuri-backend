# Temakuri — Backend

## Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run start:dev
```

Servidor sobe em http://localhost:3001
Docs Swagger em http://localhost:3001/docs
WebSocket em ws://localhost:3001/ws?token=<JWT>

## Variáveis de ambiente

| Var | Valor padrão | Descrição |
|-----|-------------|-----------|
| DATABASE_URL | file:./dev.db | Caminho do SQLite |
| JWT_SECRET | - | Segredo do access token |
| JWT_REFRESH_SECRET | - | Segredo do refresh token |
| JWT_EXPIRES_IN | 15m | Expiração do access token |
| JWT_REFRESH_EXPIRES_IN | 7d | Expiração do refresh token |
| FRONTEND_URL | http://localhost:5173 | CORS origin |
| PORT | 3001 | Porta do servidor |
