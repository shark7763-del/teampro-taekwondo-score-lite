import type { MatchState, RoundResult, Scores } from '../types'

/**
 * 計分板「這一刻該顯示什麼」的推導。
 *
 * 為什麼需要這一層：三回合兩勝制下，回合一結束 `finalizeRound` 就會把
 * `currentRound` 推到下一回合、`scores` 歸零（規則上完全正確，每回合本來就獨立計算）。
 * 但畫面若照實顯示，教練與選手在休息時間看到的是下一回合的 0:0——
 * 剛打完那一回合的比分**連看都沒看到就消失了**。
 *
 * 所以顯示層要自己決定：休息中要亮出剛結束那一回合的結果。
 * 這是純顯示邏輯，不動任何規則。
 */
export interface ScoreboardView {
  /** 應該顯示的比分 */
  scores: Scores
  /** 應該顯示的回合編號 */
  round: number
  /** 正在亮分的已結束回合；null 代表在比賽進行中，顯示的是即時比分 */
  finishedRound: RoundResult | null
  /** 休息結束後要進行的回合；null 代表沒有下一回合 */
  nextRound: number | null
}

function scoresOfResult(result: RoundResult): Scores {
  return {
    blueScore: result.blueScore,
    redScore: result.redScore,
    blueGamjeom: result.blueGamjeom,
    redGamjeom: result.redGamjeom,
  }
}

function lastResult(state: MatchState): RoundResult | undefined {
  return state.roundResults.length > 0
    ? state.roundResults[state.roundResults.length - 1]
    : undefined
}

export function scoreboardView(state: MatchState): ScoreboardView {
  const last = lastResult(state)

  if (state.matchStatus === 'REST' && last !== undefined) {
    return {
      scores: scoresOfResult(last),
      round: last.round,
      finishedRound: last,
      nextRound: state.currentRound,
    }
  }

  if (state.matchStatus === 'FINISHED') {
    // 比賽結束時 finalizeRound 沒有歸零，state.scores 就是最後一回合的比分
    return {
      scores: state.scores,
      round: state.currentRound,
      finishedRound: last ?? null,
      nextRound: null,
    }
  }

  return {
    scores: state.scores,
    round: state.currentRound,
    finishedRound: null,
    nextRound: null,
  }
}
