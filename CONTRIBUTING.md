# Contribuindo com o Temakuri (Backend)

Obrigado pelo interesse em contribuir! Este documento explica como o projeto funciona e como participar.

## Código de conduta

Trate todos com respeito. Contribuições que contenham ofensas, discriminação ou assédio serão descartadas.

## Como contribuir

### Reportar bugs

Abra uma [issue](https://github.com/franceschinii/temakuri-backend/issues) com:

- Descrição clara do problema
- Endpoint ou evento Socket.IO envolvido
- Payload de entrada e resposta observada vs. esperada
- Logs relevantes (sem dados pessoais)

### Sugerir melhorias

Abra uma issue com a tag `enhancement`. Descreva o problema que a melhoria resolve.

**Atenção:** alterações na lógica do jogo (engine, regras, balanceamento) exigem discussão prévia — impactam todos os jogadores e precisam de alinhamento com o dono do projeto.

### Enviar código

1. Faça fork do repositório
2. Crie uma branch curta a partir de `main`:
   ```
   git checkout -b feat/nome-curto
   ```
3. Faça commits pequenos seguindo [Conventional Commits](https://www.conventionalcommits.org/) em português:
   ```
   feat(rooms): limita criacao de salas por usuario logado
   fix(engine): corrige contagem de passes consecutivos no duelo
   ```
4. Abra um Pull Request para `main`

### O que aceito vs. o que não aceito

**Aceito:**
- Correções de bugs com teste de regressão
- Melhorias de performance com benchmark
- Correções de segurança (reporte primeiro por e-mail — veja SECURITY.md)
- Melhoria de cobertura de testes
- Correções de typo em mensagens de erro

**Não aceito sem discussão prévia:**
- Mudanças nas regras do jogo (GameEngine)
- Novos módulos ou integrações externas
- Mudanças no schema do banco (migrations)
- Alterações no sistema de pagamentos

## Setup local

```bash
git clone https://github.com/franceschinii/temakuri-backend.git
cd temakuri-backend
npm install
cp .env.example .env
# edite .env: defina DATABASE_URL, JWT_SECRET e JWT_REFRESH_SECRET
npx prisma migrate dev
npx prisma db seed
npm run start:dev
```

Veja o README para setup completo com Docker.

## Stack

- NestJS 11 + TypeScript
- PostgreSQL + Prisma 6
- Socket.IO (jogo em tempo real)
- JWT (access + refresh tokens)
- Mercado Pago (pagamentos — desabilitado por padrão)

## Padrões do projeto

- Um módulo NestJS por domínio (`auth`, `game`, `rooms`, `payments`...)
- DTOs com validação via `class-validator`
- Testes em `test/` com Jest — rode `npm test` antes de abrir PR
- Sem secrets hardcoded — tudo via variáveis de ambiente
- Sem `any` no TypeScript

## Rodando os testes

```bash
# Testes unitários e de integração
npm test

# Com cobertura
npm run test:cov
```

Os testes de integração usam um banco PostgreSQL separado. Configure `DATABASE_URL` no `.env.test` apontando para uma instância de teste.

## Dúvidas

Abra uma issue com a tag `question` ou envie e-mail para contato@andrefranceschini.com.br.
