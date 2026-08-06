import { describe, expect, it } from 'vitest'
import { applyCommands, createMatchState, reduceMatch } from './matchCore'
import type { MatchCommand } from './matchCore'
import { buildGamjeomEvent, resolveRoundOutcome } from '../rules/ruleEngine'
import { getRuleSet } from '../rules/ruleSets'
import type { MatchEvent, MatchState } from '../types'

/**
 * 三個既有缺陷的回歸測試。
 *
 * BUG-2：分數在累加時被 Math.max(0, ...) 截斷，導致復原不可逆
 *        （藍方 2 分 → 手動扣 3 分被截成 0 → 復原那筆 +3 變成 3 分，憑空多一分）。
 *        改為累加精確、由指令邊界拒絕會造成負分的操作。
 * BUG-3：雙方在同一回合都達到 Gam-jeom 上限時，兩個判斷式都不成立，
 *        靜默落到比分數，等於整條上限規則被忽略。
 * BUG-6：計時器 elapsed 為負時（跨裝置時鐘校正略微高估）會算出超過回合長度的剩餘時間。
 */

const T0 = 1_700_000_000_000
const RULES = getRuleSet()

function newMatch(overrides = {}): MatchState {
  return createMatchState({ totalRounds: 3, roundDurationMs: 90_000, ...overrides }, T0)
}

function run(state: MatchState, commands: MatchCommand[]): MatchState {
  return applyCommands(state, commands, T0, 10)
}

describe('BUG-2｜分數不得變成負數，且復原必須可逆', () => {
  it('手動扣分超過現有分數會被拒絕，且不留下事件', () => {
    const state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
    ])
    expect(state.scores.blueScore).toBe(2)

    const result = reduceMatch(
      state,
      { type: 'MANUAL_ADJUST', side: 'BLUE', deltaPoints: -3, note: '扣過頭' },
      T0 + 1_000,
    )

    expect(result.rejected).toBe('WOULD_GO_NEGATIVE')
    expect(result.state.scores.blueScore).toBe(2)
    // 關鍵：被拒絕的操作不可以留下事件，否則重播會算出負分
    expect(result.state.events).toHaveLength(1)
  })

  it('扣到剛好 0 是允許的', () => {
    const state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
    ])
    const result = reduceMatch(
      state,
      { type: 'MANUAL_ADJUST', side: 'BLUE', deltaPoints: -2, note: '取消該次得分' },
      T0 + 1_000,
    )
    expect(result.rejected).toBeUndefined()
    expect(result.state.scores.blueScore).toBe(0)
  })

  it('「扣分後復原早期得分」不會憑空生出分數', () => {
    // 這正是 BUG-2 的情境：舊版會 2 →（扣 3 截成）0 →（復原 +3）3
    let state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
    ])
    const scoreEventId = state.events[0]?.id ?? ''

    // 扣 2 分（合法，剛好歸零）
    state = reduceMatch(
      state,
      { type: 'MANUAL_ADJUST', side: 'BLUE', deltaPoints: -2, note: '誤判' },
      T0 + 1_000,
    ).state
    expect(state.scores.blueScore).toBe(0)

    // 再去復原最早那筆 +2：會讓分數變 -2，必須被拒絕
    const result = reduceMatch(state, { type: 'REVERSE_EVENT', eventId: scoreEventId }, T0 + 2_000)
    expect(result.rejected).toBe('WOULD_GO_NEGATIVE')
    expect(result.state.scores.blueScore).toBe(0)
  })

  it('正常得分後復原，分數完全還原（可逆性）', () => {
    const started = run(newMatch(), [{ type: 'START' }])
    const scored = reduceMatch(
      started,
      { type: 'SCORE', side: 'BLUE', action: 'TURNING_HEAD_KICK' },
      T0 + 100,
    ).state
    const undone = reduceMatch(scored, { type: 'UNDO' }, T0 + 200).state
    expect(undone.scores).toEqual(started.scores)
  })
})

/*
 * 註：正常操作走不到「雙方同時達上限」——withEvent 一偵測到任一方達上限
 * 就立刻結算回合，所以先到的那一方會先結束比賽。
 * 但 resolveRoundOutcome 是公開函式，休息中判罰、PREV_ROUND 之後補判等路徑
 * 都可能餵進這種事件列表，因此仍需在規則層把行為定義清楚，
 * 而不是讓它靜默落到比分數、等於整條上限規則被忽略。
 */
describe('BUG-3｜雙方同回合都達到 Gam-jeom 上限（規則層）', () => {
  function gamjeomEvents(blueCount: number, redCount: number): MatchEvent[] {
    const events: MatchEvent[] = []
    const base = {
      matchId: 'm1',
      round: 1,
      remainingMsAtEvent: 30_000,
      ruleSetCode: RULES.code,
      source: 'OPERATOR' as const,
      createdBy: 'test',
      now: T0,
      reason: 'OTHER' as const,
      opponentPoints: RULES.gamjeom.normalOpponentPoints,
      isSpecial: false,
    }
    for (let i = 0; i < blueCount; i += 1) {
      events.push(buildGamjeomEvent({ ...base, penalizedSide: 'BLUE' }))
    }
    for (let i = 0; i < redCount; i += 1) {
      events.push(buildGamjeomEvent({ ...base, penalizedSide: 'RED' }))
    }
    return events
  }

  it('雙方都達上限時不自行用分數決定勝負，交由教練優勢判定', () => {
    const limit = RULES.round.gamjeomLimitPerRound
    const outcome = resolveRoundOutcome(gamjeomEvents(limit, limit), 1)

    expect(outcome.scores.blueGamjeom).toBe(limit)
    expect(outcome.scores.redGamjeom).toBe(limit)
    // 兩邊互相加分，分數其實相同；重點是不可以用分數當理由
    expect(outcome.winner).toBeNull()
    expect(outcome.reason).toBeNull()
  })

  it('雙方都超過上限、且分數不同時，仍然不用分數判定', () => {
    const limit = RULES.round.gamjeomLimitPerRound
    // 藍方多被判一次 → 紅方分數較高，舊版會誤判紅方以 POINTS 獲勝
    const outcome = resolveRoundOutcome(gamjeomEvents(limit + 1, limit), 1)

    expect(outcome.scores.redScore).toBeGreaterThan(outcome.scores.blueScore)
    expect(outcome.winner).toBeNull()
    expect(outcome.reason).toBeNull()
  })

  it('只有一方達上限時仍然直接判給對手', () => {
    const commands: MatchCommand[] = [{ type: 'START' }]
    for (let i = 0; i < RULES.round.gamjeomLimitPerRound; i += 1) {
      commands.push({ type: 'GAMJEOM', side: 'BLUE', reason: 'OTHER', special: false })
    }
    const state = run(newMatch(), commands)
    expect(state.roundResults[0]?.winner).toBe('RED')
    expect(state.roundResults[0]?.reason).toBe('GAMJEOM_LIMIT')
  })
})
