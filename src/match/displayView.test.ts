import { describe, expect, it } from 'vitest'
import { scoreboardView } from './displayView'
import { applyCommands, createMatchState } from './matchCore'
import type { MatchCommand } from './matchCore'
import type { MatchState } from '../types'

/**
 * 回歸測試：回合結束時比分不可以直接歸零消失。
 *
 * 現場回報：一回合打完，電視上的比分瞬間變 0:0，教練與選手根本沒看到剛才打了幾比幾。
 * 原因是 finalizeRound 進入休息時就把 currentRound 推到下一回合、scores 歸零
 * （規則上正確），顯示層卻照實顯示。
 */

const T0 = 1_700_000_000_000

function run(commands: MatchCommand[], overrides = {}): MatchState {
  return applyCommands(
    createMatchState(
      { totalRounds: 3, roundDurationMs: 90_000, restDurationMs: 30_000, ...overrides },
      T0,
    ),
    commands,
    T0,
    10,
  )
}

describe('計分板顯示推導', () => {
  it('比賽進行中顯示即時比分', () => {
    const state = run([{ type: 'START' }, { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' }])
    const view = scoreboardView(state)

    expect(view.scores.blueScore).toBe(3)
    expect(view.round).toBe(1)
    expect(view.finishedRound).toBeNull()
    expect(view.nextRound).toBeNull()
  })

  it('休息中亮出剛結束那一回合的比分，不是下一回合的 0:0', () => {
    const state = run([
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
      { type: 'SCORE', side: 'RED', action: 'BODY_PUNCH' },
      { type: 'NEXT_ROUND' },
    ])
    expect(state.matchStatus).toBe('REST')
    // 狀態本身確實已經歸零並推進，這是規則層應有的行為
    expect(state.scores.blueScore).toBe(0)
    expect(state.currentRound).toBe(2)

    const view = scoreboardView(state)
    expect(view.scores.blueScore).toBe(5)
    expect(view.scores.redScore).toBe(1)
    expect(view.round).toBe(1)
    expect(view.finishedRound?.winner).toBe('BLUE')
    expect(view.finishedRound?.reason).toBe('POINTS')
    expect(view.nextRound).toBe(2)
  })

  it('休息中也要保留該回合的 Gam-jeom 次數', () => {
    const state = run([
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'GAMJEOM', side: 'RED', reason: 'OTHER', special: false },
      { type: 'NEXT_ROUND' },
    ])
    const view = scoreboardView(state)
    expect(view.scores.redGamjeom).toBe(1)
    expect(view.scores.blueScore).toBe(4)
  })

  it('比賽結束時顯示最後一回合的比分與該回合結果', () => {
    let state = createMatchState({ totalRounds: 3, roundDurationMs: 90_000 }, T0)
    for (const round of [1, 2]) {
      state = applyCommands(
        state,
        [
          { type: 'START' },
          { type: 'SCORE', side: 'RED', action: 'HEAD_KICK' },
          { type: 'NEXT_ROUND' },
          ...(round === 1 ? ([{ type: 'NEXT_ROUND' }] as MatchCommand[]) : []),
        ],
        T0 + round * 1_000,
        10,
      )
    }
    expect(state.matchStatus).toBe('FINISHED')

    const view = scoreboardView(state)
    expect(view.scores.redScore).toBe(3)
    expect(view.finishedRound?.winner).toBe('RED')
    expect(view.nextRound).toBeNull()
  })

  it('等待優勢判定時顯示的是該回合的實際比分', () => {
    const state = run([
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'SCORE', side: 'RED', action: 'HEAD_KICK' },
      { type: 'NEXT_ROUND' },
    ])
    expect(state.pendingSuperiorityRound).toBe(1)

    const view = scoreboardView(state)
    expect(view.scores.blueScore).toBe(3)
    expect(view.scores.redScore).toBe(3)
    expect(view.round).toBe(1)
  })

  it('尚未開始時顯示 0:0，且沒有已結束回合', () => {
    const view = scoreboardView(createMatchState({}, T0))
    expect(view.scores.blueScore).toBe(0)
    expect(view.finishedRound).toBeNull()
    expect(view.round).toBe(1)
  })
})
