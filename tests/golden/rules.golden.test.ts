import { describe, expect, it } from 'vitest'
import { applyCommands, createMatchState, reduceMatch } from '../../src/match/matchCore'
import type { MatchCommand } from '../../src/match/matchCore'
import { computeRoundScores, pointsForAction } from '../../src/rules/ruleEngine'
import { getRuleSet } from '../../src/rules/ruleSets'
import type { MatchState } from '../../src/types'

/**
 * 黃金規則情境。
 *
 * ⚠️ 本檔為鎖定檔案，AutoResearch 迴圈不得修改、不得刪除任何一條。
 *
 * 這裡只寫**已經人工確認過**的規則。仍待官方核對或待使用者裁示的項目
 * （雙方同時達 Gam-jeom 上限、分差門檻是否計入該筆得分、
 * Gam-jeom 可否在未開賽／休息中判、手動扣分可否為負）
 * 一律不寫進來——把未確認的行為釘死，比沒有測試更危險。
 */

const T0 = 1_700_000_000_000
const RULES = getRuleSet()

function newMatch(overrides = {}): MatchState {
  return createMatchState(
    { totalRounds: 3, roundDurationMs: 90_000, restDurationMs: 30_000, ...overrides },
    T0,
  )
}

function run(state: MatchState, commands: MatchCommand[], stepMs = 10): MatchState {
  return applyCommands(state, commands, T0, stepMs)
}

describe('黃金｜分值', () => {
  it('基本分值：正拳 1、身體踢 2、頭部踢 3', () => {
    expect(pointsForAction('BODY_PUNCH')).toBe(1)
    expect(pointsForAction('BODY_KICK')).toBe(2)
    expect(pointsForAction('HEAD_KICK')).toBe(3)
  })

  it('旋轉技術 = 對應基本技術 × turningMultiplier，不是舊制的 +2', () => {
    expect(pointsForAction('TURNING_BODY_KICK')).toBe(
      pointsForAction('BODY_KICK') * RULES.turningMultiplier,
    )
    expect(pointsForAction('TURNING_HEAD_KICK')).toBe(
      pointsForAction('HEAD_KICK') * RULES.turningMultiplier,
    )
    // 2026 規則下實際數字
    expect(pointsForAction('TURNING_BODY_KICK')).toBe(4)
    expect(pointsForAction('TURNING_HEAD_KICK')).toBe(6)
  })
})

describe('黃金｜三回合兩勝制', () => {
  it('每回合分數歸零重新計算，不是整場累加', () => {
    let state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'NEXT_ROUND' },
    ])
    expect(state.roundResults).toHaveLength(1)
    expect(state.roundResults[0]?.blueScore).toBe(6)
    expect(state.currentRound).toBe(2)
    // 第二回合開場一定是 0:0
    expect(state.scores.blueScore).toBe(0)
    expect(state.scores.redScore).toBe(0)

    state = reduceMatch(state, { type: 'NEXT_ROUND' }, T0 + 1_000).state
    state = reduceMatch(state, { type: 'START' }, T0 + 1_100).state
    state = reduceMatch(
      state,
      { type: 'SCORE', side: 'RED', action: 'BODY_KICK' },
      T0 + 1_200,
    ).state
    // 第二回合只看第二回合的事件
    expect(computeRoundScores(state.events, 2)).toMatchObject({ blueScore: 0, redScore: 2 })
  })

  it('先贏 2 個回合即獲勝，2:0 時不進行第三回合', () => {
    let state = newMatch()
    for (const round of [1, 2]) {
      state = reduceMatch(state, { type: 'START' }, T0 + round * 1_000).state
      state = reduceMatch(
        state,
        { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
        T0 + round * 1_000 + 100,
      ).state
      state = reduceMatch(state, { type: 'NEXT_ROUND' }, T0 + round * 1_000 + 200).state
      if (round === 1) {
        state = reduceMatch(state, { type: 'NEXT_ROUND' }, T0 + round * 1_000 + 300).state
      }
    }
    expect(state.roundWins).toEqual({ blue: 2, red: 0 })
    expect(state.matchStatus).toBe('FINISHED')
    expect(state.matchWinner).toBe('BLUE')
    // 關鍵：只打了 2 個回合
    expect(state.roundResults).toHaveLength(2)
    expect(state.currentRound).toBe(2)
  })
})

describe('黃金｜Gam-jeom', () => {
  it('一般 Gam-jeom：對手 +1，受罰方 Gam-jeom +1', () => {
    const state = run(newMatch(), [
      { type: 'START' },
      { type: 'GAMJEOM', side: 'BLUE', reason: 'OTHER', special: false },
    ])
    expect(state.scores.redScore).toBe(RULES.gamjeom.normalOpponentPoints)
    expect(state.scores.blueScore).toBe(0)
    expect(state.scores.blueGamjeom).toBe(1)
    expect(state.scores.redGamjeom).toBe(0)
  })

  it('回合最後 10 秒消極行為：對手 +2，但 Gam-jeom 仍只記 1 次，且不再加一般的 1 分', () => {
    const short = newMatch({ roundDurationMs: 12_000 })
    let state = reduceMatch(short, { type: 'START' }, T0).state
    // 推進到剩 5 秒
    state = reduceMatch(
      state,
      { type: 'GAMJEOM', side: 'BLUE', reason: 'AVOIDING', special: true },
      T0 + 7_000,
    ).state

    expect(state.scores.redScore).toBe(RULES.gamjeom.lastSecondsOpponentPoints)
    expect(state.scores.redScore).toBe(2)
    expect(state.scores.blueGamjeom).toBe(1)
  })

  it('未進入最後 10 秒時，加重處罰不成立且分數不變', () => {
    const state = newMatch({ roundDurationMs: 90_000 })
    const started = reduceMatch(state, { type: 'START' }, T0).state
    const result = reduceMatch(
      started,
      { type: 'GAMJEOM', side: 'BLUE', reason: 'AVOIDING', special: true },
      T0 + 1_000,
    )
    expect(result.rejected).toBe('NOT_LAST_10_SECONDS')
    expect(result.state.scores.redScore).toBe(0)
    expect(result.state.scores.blueGamjeom).toBe(0)
  })

  it('單一回合累積 5 次 Gam-jeom，該回合直接判給對手', () => {
    const commands: MatchCommand[] = [{ type: 'START' }]
    for (let i = 0; i < RULES.round.gamjeomLimitPerRound; i += 1) {
      commands.push({ type: 'GAMJEOM', side: 'BLUE', reason: 'OTHER', special: false })
    }
    const state = run(newMatch(), commands)

    expect(state.roundResults).toHaveLength(1)
    expect(state.roundResults[0]?.winner).toBe('RED')
    expect(state.roundResults[0]?.reason).toBe('GAMJEOM_LIMIT')
    // 只輸掉這個回合，不是整場結束
    expect(state.matchStatus).not.toBe('FINISHED')
    expect(state.roundWins).toEqual({ blue: 0, red: 1 })
  })
})

describe('黃金｜回合提前結束', () => {
  it('分差達門檻時該回合提前結束', () => {
    const commands: MatchCommand[] = [{ type: 'START' }]
    // 每次 +6，直到超過門檻
    const times = Math.ceil(RULES.round.pointGapThreshold / 6)
    for (let i = 0; i < times; i += 1) {
      commands.push({ type: 'SCORE', side: 'BLUE', action: 'TURNING_HEAD_KICK' })
    }
    const state = run(newMatch(), commands)

    expect(state.roundResults).toHaveLength(1)
    expect(state.roundResults[0]?.winner).toBe('BLUE')
    expect(state.roundResults[0]?.reason).toBe('POINT_GAP')
  })
})

describe('黃金｜復原', () => {
  it('復原後比分完全還原，且原事件與復原事件兩筆都保留', () => {
    const started = run(newMatch(), [{ type: 'START' }])
    const scored = reduceMatch(
      started,
      { type: 'SCORE', side: 'BLUE', action: 'TURNING_HEAD_KICK' },
      T0 + 100,
    ).state
    expect(scored.scores.blueScore).toBe(6)

    const undone = reduceMatch(scored, { type: 'UNDO' }, T0 + 200).state
    expect(undone.scores).toEqual(started.scores)
    // 事件永不刪除
    expect(undone.events).toHaveLength(2)
    expect(undone.events[0]?.type).toBe('SCORE')
    expect(undone.events[1]?.type).toBe('REVERSAL')
  })

  it('同一筆事件只能被復原一次', () => {
    let state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
      { type: 'UNDO' },
    ])
    const eventId = state.events[0]?.id ?? ''
    const again = reduceMatch(state, { type: 'REVERSE_EVENT', eventId }, T0 + 5_000)
    expect(again.rejected).toBe('ALREADY_REVERSED')
    state = again.state
    expect(state.scores.blueScore).toBe(0)
  })

  it('復原 Gam-jeom 會同時還原對手分數與受罰方的 Gam-jeom 次數', () => {
    const state = run(newMatch(), [
      { type: 'START' },
      { type: 'GAMJEOM', side: 'BLUE', reason: 'OTHER', special: false },
      { type: 'UNDO' },
    ])
    expect(state.scores).toMatchObject({
      blueScore: 0,
      redScore: 0,
      blueGamjeom: 0,
      redGamjeom: 0,
    })
  })
})

describe('黃金｜回合平手判定順序', () => {
  it('分數相同時，旋轉技術得分較多者勝', () => {
    // 藍：旋身 4 + 拳 1 + 拳 1 = 6（旋轉分 4）
    // 紅：頭部 3 + 頭部 3 = 6（旋轉分 0）
    const state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'TURNING_BODY_KICK' },
      { type: 'SCORE', side: 'BLUE', action: 'BODY_PUNCH' },
      { type: 'SCORE', side: 'BLUE', action: 'BODY_PUNCH' },
      { type: 'SCORE', side: 'RED', action: 'HEAD_KICK' },
      { type: 'SCORE', side: 'RED', action: 'HEAD_KICK' },
      { type: 'NEXT_ROUND' },
    ])
    expect(state.roundResults[0]?.blueScore).toBe(6)
    expect(state.roundResults[0]?.redScore).toBe(6)
    expect(state.roundResults[0]?.winner).toBe('BLUE')
    expect(state.roundResults[0]?.reason).toBe('TURNING_POINTS')
  })

  it('分數與旋轉分都相同時，高分值技術數量較多者勝', () => {
    // 兩邊都 0 旋轉分、都 6 分
    // 藍：3 + 3        （3 分技術 2 次）
    // 紅：2 + 2 + 1 + 1（3 分技術 0 次）
    const state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'SCORE', side: 'RED', action: 'BODY_KICK' },
      { type: 'SCORE', side: 'RED', action: 'BODY_KICK' },
      { type: 'SCORE', side: 'RED', action: 'BODY_PUNCH' },
      { type: 'SCORE', side: 'RED', action: 'BODY_PUNCH' },
      { type: 'NEXT_ROUND' },
    ])
    expect(state.roundResults[0]?.blueScore).toBe(6)
    expect(state.roundResults[0]?.redScore).toBe(6)
    expect(state.roundResults[0]?.winner).toBe('BLUE')
    expect(state.roundResults[0]?.reason).toBe('HIGHER_TECHNIQUE')
  })

  it('所有條件都相同時不自行猜測，交由教練優勢判定', () => {
    const state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'SCORE', side: 'RED', action: 'HEAD_KICK' },
      { type: 'NEXT_ROUND' },
    ])
    expect(state.pendingSuperiorityRound).toBe(1)
    expect(state.roundResults).toHaveLength(0)

    const decided = reduceMatch(state, { type: 'DECIDE_SUPERIORITY', winner: 'RED' }, T0 + 9_000)
      .state
    expect(decided.roundResults[0]?.winner).toBe('RED')
    expect(decided.roundResults[0]?.reason).toBe('SUPERIORITY')
  })
})

describe('黃金｜計分閘門', () => {
  it('尚未開始比賽時不得計分', () => {
    const result = reduceMatch(newMatch(), { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' }, T0)
    expect(result.rejected).toBe('MATCH_NOT_RUNNING')
    expect(result.state.scores.blueScore).toBe(0)
  })

  it('比賽結束後不得計分', () => {
    const finished = run(newMatch(), [{ type: 'START' }, { type: 'FINISH' }])
    const result = reduceMatch(
      finished,
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      T0 + 1_000,
    )
    expect(result.rejected).toBe('MATCH_FINISHED')
  })

  it('同一個雙裁判配對群組只能計分一次', () => {
    let state = run(newMatch(), [{ type: 'START' }])
    const command: MatchCommand = {
      type: 'SCORE',
      side: 'BLUE',
      action: 'BODY_KICK',
      source: 'JUDGE_PAIR',
      matchedGroupId: 'group-1',
    }
    state = reduceMatch(state, command, T0 + 100).state
    state = reduceMatch(state, command, T0 + 200).state
    expect(state.scores.blueScore).toBe(2)
  })
})
