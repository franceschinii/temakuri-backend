-- Reset de stats afetadas pela mudança de regra fundamental (0.7.0):
--
-- gamesWon: antes era incrementado por "placement === 1" (quem zerava a mão
-- primeiro). Com a nova regra, vitória = "não foi o eliminado". Em
-- multi-player isso muda completamente; valores históricos refletem a
-- definição antiga e geram leituras enganosas.
--
-- saborTriggers: era creditado ao "fake winner" (placement 1), não a quem
-- realmente disparou o sabor. Sempre esteve incorreto.
--
-- Campos NÃO afetados (deliberadamente preservados):
-- - tricksWon: já vinha correto do engine (independente da regra)
-- - rankedWins/rankedLosses: ranked sempre foi 1v1 na prática (semântica
--   coincide com a nova regra)
-- - pds, peakPds, winStreak, lossStreak: idem (ranked 1v1)
-- - xp, level, coins, diamonds: recompensa "ganha", não condicional
-- - GameResult: log histórico imutável

UPDATE "UserStats" SET "gamesWon" = 0, "saborTriggers" = 0;
