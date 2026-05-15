-- Adiciona campo isWinner em GameResult. Default true pra novos registros.
-- Backfill historico: registros antigos viram isWinner = (tokensLeft > 0),
-- que eh a definicao correta pela nova regra (sobreviveu = nao perdeu todos
-- os pratos).

ALTER TABLE "GameResult" ADD COLUMN "isWinner" BOOLEAN NOT NULL DEFAULT true;

UPDATE "GameResult" SET "isWinner" = ("tokensLeft" > 0);
