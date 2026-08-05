import { describe, expect, it } from 'vitest'
import {
  buildScoreEvent,
  canApplyTurningBonus,
  describeEvent,
  isBaseAction,
  isKickAction,
  isTurningAction,
  listActions,
  opponentOf,
  pssBreakdown,
  reasonLabel,
  resolveRoundOutcome,
  roundReasonLabel,
  roundWinsNeeded,
  shortDescribeEvent,
  sideLabel,
  techniqueCountsInRound,
  turningPointsInRound,
} from './ruleEngine'
import { WT_2026_06_01_OFFICIAL, getRuleSet } from './ruleSets'
import type { ActionType, MatchEvent, RoundWinReason } from '../types'

/**
 * 規則層中「從未被執行到」的分支。
 *
 * 突變測試顯示 ruleEngine.ts 有 66 個突變體完全沒被執行到，
 * 集中在 PSS 模擬模式、正式規則模式的平手判定，以及顯示文字。
 * 顯示文字看似無關緊要，但 Gam-jeom 的文案寫錯會讓教練按錯邊，
 * 所以「藍方違規 → 紅方得分」這個語意必須被測試釘死。
 */

const T0 = 1_700_000_000_000

function scoreEvent(
  overrides: Partial<Omit<MatchEvent, 'actionType'>> & { actionType?: ActionType } = {},
): MatchEvent {
  return buildScoreEvent({
    matchId: 'm1',
    round: 1,
    remainingMsAtEvent: 60_000,
    ruleSetCode: getRuleSet().code,
    source: 'SOLO',
    createdBy: 'test',
    now: T0,
    athleteSide: 'BLUE',
    actionType: 'BODY_KICK',
    ...overrides,
  })
}

describe('技術分類', () => {
  it('旋轉技術與基本技術互斥', () => {
    for (const { action } of listActions()) {
      expect(isTurningAction(action)).toBe(!isBaseAction(action))
    }
  })

  it('只有正拳不是踢擊', () => {
    expect(isKickAction('BODY_PUNCH')).toBe(false)
    expect(isKickAction('BODY_KICK')).toBe(true)
    expect(isKickAction('HEAD_KICK')).toBe(true)
    expect(isKickAction('TURNING_BODY_KICK')).toBe(true)
    expect(isKickAction('TURNING_HEAD_KICK')).toBe(true)
  })

  it('按鈕清單順序固定，避免現場誤觸', () => {
    expect(listActions().map((a) => a.action)).toEqual([
      'BODY_PUNCH',
      'BODY_KICK',
      'HEAD_KICK',
      'TURNING_BODY_KICK',
      'TURNING_HEAD_KICK',
    ])
    expect(listActions().map((a) => a.points)).toEqual([1, 2, 3, 4, 6])
  })

  it('對手是另一方', () => {
    expect(opponentOf('BLUE')).toBe('RED')
    expect(opponentOf('RED')).toBe('BLUE')
  })
})

describe('PSS 模擬模式的分數拆解', () => {
  it('正拳全部由裁判確認，護具不自動判定', () => {
    expect(pssBreakdown('BODY_PUNCH')).toEqual({
      pssAutoPoints: 0,
      judgeAdditionalPoints: 1,
      totalPoints: 1,
    })
  })

  it('一般踢擊全部由護具自動判定，沒有追加分', () => {
    expect(pssBreakdown('BODY_KICK')).toEqual({
      pssAutoPoints: 2,
      judgeAdditionalPoints: 0,
      totalPoints: 2,
    })
    expect(pssBreakdown('HEAD_KICK')).toEqual({
      pssAutoPoints: 3,
      judgeAdditionalPoints: 0,
      totalPoints: 3,
    })
  })

  it('旋轉追加分＝身體 +2、頭部 +3，不是一律 +2', () => {
    expect(pssBreakdown('TURNING_BODY_KICK')).toEqual({
      pssAutoPoints: 2,
      judgeAdditionalPoints: 2,
      totalPoints: 4,
    })
    expect(pssBreakdown('TURNING_HEAD_KICK')).toEqual({
      pssAutoPoints: 3,
      judgeAdditionalPoints: 3,
      totalPoints: 6,
    })
  })

  it('每一種技術的自動分＋追加分都等於正式分值', () => {
    for (const { action, points } of listActions()) {
      const b = pssBreakdown(action)
      expect(b.pssAutoPoints + b.judgeAdditionalPoints).toBe(points)
      expect(b.totalPoints).toBe(points)
    }
  })
})

describe('PSS 旋轉追加分的前置條件', () => {
  const rules = getRuleSet()

  it('同一方在回溯時間內有基本踢擊時才可追加', () => {
    const events = [scoreEvent({ athleteSide: 'BLUE', actionType: 'BODY_KICK' })]
    expect(canApplyTurningBonus(events, 'BLUE', T0 + 1_000).allowed).toBe(true)
  })

  it('沒有任何基本踢擊時不得單獨追加', () => {
    expect(canApplyTurningBonus([], 'BLUE', T0).allowed).toBe(false)
    expect(canApplyTurningBonus([], 'BLUE', T0).reason).toBe('NO_BASE_KICK_FOR_TURNING_BONUS')
  })

  it('對手的基本踢擊不能拿來當自己的前置條件', () => {
    const events = [scoreEvent({ athleteSide: 'RED', actionType: 'BODY_KICK' })]
    expect(canApplyTurningBonus(events, 'BLUE', T0 + 1_000).allowed).toBe(false)
  })

  it('正拳不算基本踢擊', () => {
    const events = [scoreEvent({ athleteSide: 'BLUE', actionType: 'BODY_PUNCH' })]
    expect(canApplyTurningBonus(events, 'BLUE', T0 + 1_000).allowed).toBe(false)
  })

  it('超過回溯時間的踢擊不算數', () => {
    const events = [scoreEvent({ athleteSide: 'BLUE', actionType: 'BODY_KICK' })]
    const tooLate = T0 + rules.pss.turningBonusLookbackMs + 1
    expect(canApplyTurningBonus(events, 'BLUE', tooLate).allowed).toBe(false)
    // 邊界值本身仍算數
    expect(
      canApplyTurningBonus(events, 'BLUE', T0 + rules.pss.turningBonusLookbackMs).allowed,
    ).toBe(true)
  })

  it('已被復原的踢擊不能拿來當前置條件', () => {
    const base = scoreEvent({ athleteSide: 'BLUE', actionType: 'BODY_KICK' })
    const reversal: MatchEvent = {
      ...base,
      id: 'rev-1',
      type: 'REVERSAL',
      pointsDelta: -base.pointsDelta,
      reversedEventId: base.id,
      reversedEventType: 'SCORE',
    }
    expect(canApplyTurningBonus([base, reversal], 'BLUE', T0 + 1_000).allowed).toBe(false)
  })
})

describe('正式規則模式的平手判定', () => {
  const OFFICIAL = WT_2026_06_01_OFFICIAL.code

  function tiedEvents(): MatchEvent[] {
    // 兩邊都 3 分、都沒有旋轉分、技術數量也相同
    return [
      scoreEvent({ athleteSide: 'BLUE', actionType: 'HEAD_KICK' }),
      scoreEvent({ athleteSide: 'RED', actionType: 'HEAD_KICK' }),
    ]
  }

  it('訓練模式：完全相同時交由教練判定，不自行決定', () => {
    const outcome = resolveRoundOutcome(tiedEvents(), 1, getRuleSet().code)
    expect(outcome.winner).toBeNull()
    expect(outcome.reason).toBeNull()
  })

  it('正式模式：完全相同時改比 Gam-jeom 較少者勝', () => {
    const events = [
      ...tiedEvents(),
      {
        ...scoreEvent({ athleteSide: 'BLUE' }),
        id: 'gj-1',
        type: 'GAMJEOM' as const,
        actionType: null,
        pointsDelta: 0,
        gamjeomDelta: 1,
      },
    ]
    const outcome = resolveRoundOutcome(events, 1, OFFICIAL)
    // 藍方被判罰一次，Gam-jeom 較少的紅方勝
    expect(outcome.winner).toBe('RED')
    expect(outcome.reason).toBe('FEWER_GAMJEOM')
  })

  it('正式模式下 Gam-jeom 也相同時，仍然交由主審判定', () => {
    const outcome = resolveRoundOutcome(tiedEvents(), 1, OFFICIAL)
    expect(outcome.winner).toBeNull()
  })

  it('未知的規則代碼會退回訓練規則集，不會拋錯', () => {
    expect(getRuleSet('NOT_A_REAL_RULE_SET').code).toBe(getRuleSet().code)
  })
})

describe('回合統計', () => {
  it('旋轉技術得分只計入該回合、該方、未被復原的事件', () => {
    const events = [
      scoreEvent({ athleteSide: 'BLUE', actionType: 'TURNING_HEAD_KICK' }),
      scoreEvent({ athleteSide: 'BLUE', actionType: 'HEAD_KICK' }),
      { ...scoreEvent({ athleteSide: 'BLUE', actionType: 'TURNING_BODY_KICK' }), round: 2 },
      scoreEvent({ athleteSide: 'RED', actionType: 'TURNING_BODY_KICK' }),
    ]
    expect(turningPointsInRound(events, 1, 'BLUE')).toBe(6)
    expect(turningPointsInRound(events, 2, 'BLUE')).toBe(4)
    expect(turningPointsInRound(events, 1, 'RED')).toBe(4)
  })

  it('技術數量以分值分組計算', () => {
    const events = [
      scoreEvent({ athleteSide: 'BLUE', actionType: 'HEAD_KICK' }),
      scoreEvent({ athleteSide: 'BLUE', actionType: 'HEAD_KICK' }),
      scoreEvent({ athleteSide: 'BLUE', actionType: 'BODY_PUNCH' }),
    ]
    const counts = techniqueCountsInRound(events, 1, 'BLUE')
    expect(counts.get(3)).toBe(2)
    expect(counts.get(1)).toBe(1)
    expect(counts.get(2)).toBeUndefined()
  })

  it('三回合兩勝、五回合三勝', () => {
    expect(roundWinsNeeded(3)).toBe(2)
    expect(roundWinsNeeded(5)).toBe(3)
    expect(roundWinsNeeded(1)).toBe(1)
  })
})

describe('顯示文字', () => {
  it('Gam-jeom 的敘述必須明講「受罰的是誰、得分的是誰」', () => {
    const gj: MatchEvent = {
      ...scoreEvent({ athleteSide: 'BLUE' }),
      type: 'GAMJEOM',
      actionType: null,
      pointsDelta: 1,
      gamjeomDelta: 1,
      reason: 'OUT_OF_BOUNDS',
    }
    const text = describeEvent(gj)
    expect(text).toContain('藍方 Gam-jeom')
    expect(text).toContain('紅方 +1')
  })

  it('最後 10 秒消極的 Gam-jeom 會標示出來', () => {
    const gj: MatchEvent = {
      ...scoreEvent({ athleteSide: 'RED' }),
      type: 'GAMJEOM',
      actionType: null,
      pointsDelta: 2,
      gamjeomDelta: 1,
      reason: 'AVOIDING',
      note: 'LAST_10_SECONDS_PASSIVE',
    }
    const text = describeEvent(gj)
    expect(text).toContain('（最後10秒消極）')
    expect(text).toContain('藍方 +2')
  })

  it('得分敘述含有技術名稱與分值', () => {
    expect(describeEvent(scoreEvent({ actionType: 'TURNING_HEAD_KICK' }))).toBe('藍方 旋轉頭部 +6')
  })

  it('手動修正的正負號會正確顯示', () => {
    const minus: MatchEvent = {
      ...scoreEvent(),
      type: 'MANUAL_ADJUSTMENT',
      actionType: null,
      pointsDelta: -2,
    }
    const plus: MatchEvent = { ...minus, pointsDelta: 2 }
    expect(describeEvent(minus)).toBe('藍方 手動修正 -2')
    expect(describeEvent(plus)).toBe('藍方 手動修正 +2')
  })

  it('復原按鈕上的短描述能分辨得分與判罰', () => {
    expect(shortDescribeEvent(scoreEvent({ actionType: 'HEAD_KICK' }))).toBe('藍方 +3')
    expect(
      shortDescribeEvent({
        ...scoreEvent({ athleteSide: 'RED' }),
        type: 'GAMJEOM',
        actionType: null,
      }),
    ).toBe('紅方 GJ')
    expect(
      shortDescribeEvent({
        ...scoreEvent(),
        type: 'MANUAL_ADJUSTMENT',
        actionType: null,
        pointsDelta: -1,
      }),
    ).toBe('藍方 -1')
  })

  it('每一種勝負原因與判罰原因都有可讀的中文', () => {
    const reasons: RoundWinReason[] = [
      'POINTS',
      'TURNING_POINTS',
      'HIGHER_TECHNIQUE',
      'FEWER_GAMJEOM',
      'GAMJEOM_LIMIT',
      'POINT_GAP',
      'SUPERIORITY',
    ]
    for (const r of reasons) {
      expect(roundReasonLabel(r)).toBeTruthy()
      expect(roundReasonLabel(r)).not.toBe(r)
    }
    for (const r of ['OUT_OF_BOUNDS', 'FALLING_DOWN', 'AVOIDING', 'OTHER'] as const) {
      expect(reasonLabel(r)).toBeTruthy()
      expect(reasonLabel(r)).not.toBe(r)
    }
    expect(sideLabel('BLUE')).toBe('藍方')
    expect(sideLabel('RED')).toBe('紅方')
  })
})
