-- Adiciona coluna botDifficulty no User. Para bots controla a IA;
-- humanos mantem NULL. Nao tem default — bots existentes ficam NULL
-- (interpretado como 'medium' no codigo) ate serem recriados.

ALTER TABLE "User" ADD COLUMN "botDifficulty" TEXT;
