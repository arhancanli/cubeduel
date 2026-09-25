/**
 * Your turns beside the engine's, in one sentence. A ratio rather than a
 * difference: 38 extra turns means little, "twice the engine" means something
 * whatever the scramble. A human CFOP solve usually runs two to three times.
 */
export function engineComparison(engineMoves: number, yourTurns: number | null): string | null {
  if (yourTurns === null) return null;
  if (yourTurns === engineMoves) return `You matched the engine: ${yourTurns} turns.`;
  if (yourTurns < engineMoves) return `You beat the engine's route: ${yourTurns} turns to its ${engineMoves}.`;
  return `You used ${yourTurns} turns — ${(yourTurns / engineMoves).toFixed(1)} times the engine's ${engineMoves}.`;
}
