/**
 * Seed inicial de noticias — migra a unica noticia que era hardcoded em
 * temakuri-frontend/src/data/news.ts. Aplicado uma vez pelo
 * NewsService.seedIfEmpty no primeiro boot apos a migration.
 */
export const NEWS_SEED = [
  {
    date: '2026-05-15',
    pinned: true,
    title: 'Modo Sobrevivente está chegando',
    summary:
      'Um modo onde o jogo só acaba quando sobra um único jogador com pratos.',
    body: `Um novo modo está em produção: **Sobrevivente**.

**Como vai funcionar**
No modo padrão, a partida termina assim que o primeiro jogador perde todos os pratos. No Sobrevivente é diferente: quem zera os pratos é eliminado, mas o jogo continua. As rodadas seguem até sobrar **um único jogador** ainda com pratos — esse é o grande vencedor.

**Por que isso muda o jogo**
Partidas mais longas e tensas. Cada prato perdido pesa mais, e dá pra acompanhar a eliminação de cada adversário até a disputa final ficar mano a mano.

**Ranking de verdade**
Como os jogadores são eliminados em ordem, o Sobrevivente vai ter colocação real: 1º, 2º, 3º... A recompensa acompanha o desempenho — quem aguenta mais, ganha mais.

Sem data fechada ainda. Assim que estiver pronto, entra no changelog. A regra base do jogo (zerar a mão te salva da rodada) já está valendo em todos os modos.`,
  },
  {
    date: '2026-05-14',
    pinned: false,
    title: 'O que vem a seguir',
    summary:
      'Animações mais vivas, novos temas, mais avatares e melhor qualidade visual.',
    body: `Próximas atualizações que estão sendo trabalhadas:

**Animações mais vivas**
Cartas, transições de turno e efeitos da mesa vão ganhar movimento. A mesa vai parecer mais respirando, menos estática.

**Mais temas de mesa**
Além de Bambu, Sakura e Oni, novos visuais entram em produção. Foco em ambientes mais distintos entre si.

**Mais avatares**
Novos personagens em fase de desenho. A galera atual continua, mas a coleção vai crescer.

**Qualidade visual mais alta**
Os avatares e ícones existentes vão receber retoques — paleta mais rica, traços mais limpos, mais expressão.

Sem data fechada — cada peça vai pro changelog assim que ficar pronta. Obrigado por jogar.`,
  },
];
