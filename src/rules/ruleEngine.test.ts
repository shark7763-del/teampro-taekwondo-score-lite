import { describe, expect, it } from 'vitest'
import {
  applyEventToScores,
  buildGamjeomEvent,
  buildReversalEvent,
  buildScoreEvent,
  canApplyTurningBonus,
  computeRoundScores,
  computeScores,
  EMPTY_SCORES,
  findLastReversibleEvent,
  hasNegativeScore,
  isGamjeomLimitReached,
  isPointGapReached,
  isWithinLastSeconds,
  listActions,
  opponentOf,
  pointsForAction,
  pssBreakdown,
  resolveGamjeom,
  resolveRoundOutcome,
  roundWinsNeeded,
  turningPointsInRound,
} from './ruleEngine'
import { DEFAULT_RULE_SET_CODE, WT_2026_06_01_TRAINING } from './ruleSets'
import type { AthleteSide, ActionType, MatchEvent, MatchStatus, Scores } from '../types'

const RULE = DEFAULT_RULE_SET_CODE
const NOW = 1_700_000_000_000

function scoreEvent(side: AthleteSide, action: ActionType, now = NOW): MatchEvent {
  return buildScoreEvent({
    matchId: 'm1',
    round: 1,
    remainingMsAtEvent: 60_000,
    ruleSetCode: RULE,
    source: 'SOLO',
    createdBy: 'test',
    now,
    athleteSide: side,
    actionType: action,
  })
}

function gamjeomEvent(
  penalizedSide: AthleteSide,
  opts: { remainingMs: number; requestSpecial: boolean; matchStatus?: MatchStatus },
): { event: MatchEvent | null; allowed: boolean; isSpecial: boolean } {
  const resolution = resolveGamjeom({
    penalizedSide,
    reason: 'OUT_OF_BOUNDS',
    requestSpecial: opts.requestSpecial,
    remainingMs: opts.remainingMs,
    matchStatus: opts.matchStatus ?? 'RUNNING',
    enableLast10sGamjeom: true,
    ruleSetCode: RULE,
  })
  if (!resolution.allowed) return { event: null, allowed: false, isSpecial: false }
  return {
    allowed: true,
    isSpecial: resolution.isSpecial,
    event: buildGamjeomEvent({
      matchId: 'm1',
      round: 1,
      remainingMsAtEvent: opts.remainingMs,
      ruleSetCode: RULE,
      source: 'OPERATOR',
      createdBy: 'test',
      now: NOW,
      penalizedSide,
      reason: 'OUT_OF_BOUNDS',
      opponentPoints: resolution.opponentPoints,
      isSpecial: resolution.isSpecial,
    }),
  }
}

function scoresOf(events: MatchEvent[]): Scores {
  return computeScores(events)
}

/* ================================================================== */
/* 規則測試 1–10（對應驗算清單）                                       */
/* ================================================================== */

describe('規則引擎：基本分值（WT 2026-06-01 訓練用）', () => {
  it('#1 身體正拳 = 1 分', () => {
    expect(pointsForAction('BODY_PUNCH', RULE)).toBe(1)
  })

  it('#2 身體踢擊 = 2 分', () => {
    expect(pointsForAction('BODY_KICK', RULE)).toBe(2)
  })

  it('#3 頭部踢擊 = 3 分', () => {
    expect(pointsForAction('HEAD_KICK', RULE)).toBe(3)
  })

  it('#4 旋轉身體踢擊 = 4 分，且必須由「基本分 × 2」推導', () => {
    expect(pointsForAction('TURNING_BODY_KICK', RULE)).toBe(4)
    expect(pointsForAction('TURNING_BODY_KICK', RULE)).toBe(
      WT_2026_06_01_TRAINING.basePoints.BODY_KICK * WT_2026_06_01_TRAINING.turningMultiplier,
    )
  })

  it('#5 旋轉頭部踢擊 = 6 分，且必須由「基本分 × 2」推導', () => {
    expect(pointsForAction('TURNING_HEAD_KICK', RULE)).toBe(6)
    expect(pointsForAction('TURNING_HEAD_KICK', RULE)).toBe(
      WT_2026_06_01_TRAINING.basePoints.HEAD_KICK * WT_2026_06_01_TRAINING.turningMultiplier,
    )
  })

  it('按鈕清單的分值與規則引擎一致（UI 不得自行寫死數字）', () => {
    expect(listActions(RULE).map((a) => a.points)).toEqual([1, 2, 3, 4, 6])
  })

  it('得分事件的 pointsDelta 由規則決定，不採信外部輸入', () => {
    expect(scoreEvent('BLUE', 'TURNING_HEAD_KICK').pointsDelta).toBe(6)
  })
})

describe('規則引擎：Gam-jeom', () => {
  it('#6 一般 Gam-jeom 使對方 +1，受罰方 Gam-jeom +1', () => {
    const { event } = gamjeomEvent('BLUE', { remainingMs: 60_000, requestSpecial: false })
    expect(event).not.toBeNull()
    const scores = applyEventToScores({ ...EMPTY_SCORES }, event as MatchEvent)
    expect(scores.redScore).toBe(1)
    expect(scores.blueScore).toBe(0)
    expect(scores.blueGamjeom).toBe(1)
    expect(scores.redGamjeom).toBe(0)
  })

  it('#7 最後 10 秒消極 Gam-jeom 使對方 +2', () => {
    const { event, isSpecial } = gamjeomEvent('BLUE', { remainingMs: 8_000, requestSpecial: true })
    expect(isSpecial).toBe(true)
    const scores = applyEventToScores({ ...EMPTY_SCORES }, event as MatchEvent)
    expect(scores.redScore).toBe(2)
  })

  it('#8 最後 10 秒特殊 Gam-jeom 只記錄 1 次 Gam-jeom，且不另外加一般的 1 分', () => {
    const { event } = gamjeomEvent('RED', { remainingMs: 3_000, requestSpecial: true })
    expect(event?.gamjeomDelta).toBe(1)
    expect(event?.pointsDelta).toBe(2)
    const scores = applyEventToScores({ ...EMPTY_SCORES }, event as MatchEvent)
    expect(scores.blueScore).toBe(2) // 不是 3
    expect(scores.redGamjeom).toBe(1)
  })

  it('#9 超過最後 10 秒不得使用特殊 Gam-jeom（後端層級拒絕）', () => {
    const resolution = resolveGamjeom({
      penalizedSide: 'BLUE',
      reason: 'OUT_OF_BOUNDS',
      requestSpecial: true,
      remainingMs: 10_001,
      matchStatus: 'RUNNING',
      enableLast10sGamjeom: true,
      ruleSetCode: RULE,
    })
    expect(resolution.allowed).toBe(false)
    expect(resolution.rejection).toBe('NOT_LAST_10_SECONDS')
  })

  it('剛好 10.000 秒屬於最後 10 秒（含邊界）；時間為 0 或比賽未進行則不可', () => {
    expect(isWithinLastSeconds(10_000, RULE)).toBe(true)
    expect(isWithinLastSeconds(10_001, RULE)).toBe(false)
    expect(isWithinLastSeconds(0, RULE)).toBe(false)

    const paused = resolveGamjeom({
      penalizedSide: 'BLUE',
      reason: 'FALLING_DOWN',
      requestSpecial: true,
      remainingMs: 5_000,
      matchStatus: 'PAUSED',
      enableLast10sGamjeom: true,
      ruleSetCode: RULE,
    })
    expect(paused.allowed).toBe(false)
  })

  it('非消極類原因（OTHER）不適用加重處罰', () => {
    const resolution = resolveGamjeom({
      penalizedSide: 'BLUE',
      reason: 'OTHER',
      requestSpecial: true,
      remainingMs: 5_000,
      matchStatus: 'RUNNING',
      enableLast10sGamjeom: true,
      ruleSetCode: RULE,
    })
    expect(resolution.allowed).toBe(false)
  })

  it('比賽已結束不得判 Gam-jeom', () => {
    const resolution = resolveGamjeom({
      penalizedSide: 'RED',
      reason: 'OUT_OF_BOUNDS',
      requestSpecial: false,
      remainingMs: 30_000,
      matchStatus: 'FINISHED',
      enableLast10sGamjeom: true,
      ruleSetCode: RULE,
    })
    expect(resolution.allowed).toBe(false)
    expect(resolution.rejection).toBe('MATCH_FINISHED')
  })

  it('#31 Gam-jeom 分數必須加給正確的對手（藍方違規 → 紅方得分）', () => {
    const blue = gamjeomEvent('BLUE', { remainingMs: 60_000, requestSpecial: false })
    const red = gamjeomEvent('RED', { remainingMs: 60_000, requestSpecial: false })
    const scores = scoresOf([blue.event as MatchEvent, red.event as MatchEvent])
    expect(scores.redScore).toBe(1)
    expect(scores.blueScore).toBe(1)
    expect(scores.blueGamjeom).toBe(1)
    expect(scores.redGamjeom).toBe(1)
    expect(opponentOf('BLUE')).toBe('RED')
  })
})

describe('規則引擎：PSS 模擬模式（第二版 UI，第一版先鎖定規則）', () => {
  it('PSS 身體基本分 2 分、頭部基本分 3 分，正拳由裁判確認 1 分', () => {
    expect(pssBreakdown('BODY_KICK', RULE).pssAutoPoints).toBe(2)
    expect(pssBreakdown('HEAD_KICK', RULE).pssAutoPoints).toBe(3)
    expect(pssBreakdown('BODY_PUNCH', RULE).judgeAdditionalPoints).toBe(1)
  })

  it('旋轉追加分依 2026 倍數制：身體 +2、頭部 +3（不可一律寫死 +2）', () => {
    const body = pssBreakdown('TURNING_BODY_KICK', RULE)
    expect(body.pssAutoPoints).toBe(2)
    expect(body.judgeAdditionalPoints).toBe(2)
    expect(body.totalPoints).toBe(4)

    const head = pssBreakdown('TURNING_HEAD_KICK', RULE)
    expect(head.pssAutoPoints).toBe(3)
    expect(head.judgeAdditionalPoints).toBe(3)
    expect(head.totalPoints).toBe(6)
  })

  it('#10 沒有基本踢擊得分事件時，不得單獨增加旋轉追加分', () => {
    expect(canApplyTurningBonus([], 'BLUE', NOW, RULE)).toEqual({
      allowed: false,
      reason: 'NO_BASE_KICK_FOR_TURNING_BONUS',
    })
  })

  it('同一方已有基本踢擊事件時，旋轉追加分可成立', () => {
    const events = [scoreEvent('BLUE', 'BODY_KICK', NOW - 500)]
    expect(canApplyTurningBonus(events, 'BLUE', NOW, RULE).allowed).toBe(true)
  })

  it('基本踢擊屬於另一方，或已超過回溯時間，或為正拳，皆不可成立', () => {
    const otherSide = [scoreEvent('RED', 'BODY_KICK', NOW - 500)]
    expect(canApplyTurningBonus(otherSide, 'BLUE', NOW, RULE).allowed).toBe(false)

    const tooOld = [scoreEvent('BLUE', 'BODY_KICK', NOW - 10_000)]
    expect(canApplyTurningBonus(tooOld, 'BLUE', NOW, RULE).allowed).toBe(false)

    const punchOnly = [scoreEvent('BLUE', 'BODY_PUNCH', NOW - 500)]
    expect(canApplyTurningBonus(punchOnly, 'BLUE', NOW, RULE).allowed).toBe(false)
  })

  it('基本踢擊事件已被復原時，不可再作為旋轉追加分的依據', () => {
    const base = scoreEvent('BLUE', 'BODY_KICK', NOW - 500)
    const reversal = buildReversalEvent([base], base.id, {
      source: 'OPERATOR',
      createdBy: 'test',
      now: NOW,
      remainingMsAtEvent: 50_000,
    })
    expect(reversal.ok).toBe(true)
    if (!reversal.ok) return
    expect(canApplyTurningBonus([base, reversal.event], 'BLUE', NOW, RULE).allowed).toBe(false)
  })
})

/* ================================================================== */
/* 三回合兩勝制：每回合分數獨立，平手判定順序                          */
/* ================================================================== */

describe('回合制與回合勝負判定', () => {
  function inRound(event: MatchEvent, round: number): MatchEvent {
    return { ...event, round }
  }

  it('每回合分數獨立計算，不可跨回合累加', () => {
    const events = [
      inRound(scoreEvent('BLUE', 'HEAD_KICK'), 1),
      inRound(scoreEvent('BLUE', 'BODY_KICK'), 2),
      inRound(scoreEvent('RED', 'TURNING_HEAD_KICK'), 2),
    ]
    expect(computeRoundScores(events, 1)).toMatchObject({ blueScore: 3, redScore: 0 })
    expect(computeRoundScores(events, 2)).toMatchObject({ blueScore: 2, redScore: 6 })
    // 全部加總會是 5:6，但那不是任何一個回合的比分
    expect(computeScores(events)).toMatchObject({ blueScore: 5, redScore: 6 })
  })

  it('分數不同時直接由分數決定回合勝負', () => {
    const events = [scoreEvent('RED', 'BODY_KICK'), scoreEvent('BLUE', 'BODY_PUNCH')]
    expect(resolveRoundOutcome(events, 1, RULE)).toMatchObject({
      winner: 'RED',
      reason: 'POINTS',
    })
  })

  it('平手且旋轉分相同 → 比較高分值技術數量（3 分優先於 2 分）', () => {
    // 藍：3 + 1 + 1 + 1 = 6；紅：2 + 2 + 2 = 6，旋轉分皆為 0
    const events = [
      scoreEvent('BLUE', 'HEAD_KICK'),
      scoreEvent('BLUE', 'BODY_PUNCH'),
      scoreEvent('BLUE', 'BODY_PUNCH'),
      scoreEvent('BLUE', 'BODY_PUNCH'),
      scoreEvent('RED', 'BODY_KICK'),
      scoreEvent('RED', 'BODY_KICK'),
      scoreEvent('RED', 'BODY_KICK'),
    ]
    expect(resolveRoundOutcome(events, 1, RULE)).toMatchObject({
      winner: 'BLUE',
      reason: 'HIGHER_TECHNIQUE',
    })
  })

  it('訓練模式：技術也相同時不用 Gam-jeom 自動判定，直接交給主控', () => {
    // 藍方 1 次最後 10 秒消極 Gam-jeom（紅方 +2）
    // 紅方 2 次一般 Gam-jeom（藍方 +1 +1）
    // → 分數 2:2、雙方都沒有技術得分，Gam-jeom 次數不同但不作為判定依據
    const events = [
      gamjeomEvent('BLUE', { remainingMs: 5_000, requestSpecial: true }).event as MatchEvent,
      gamjeomEvent('RED', { remainingMs: 40_000, requestSpecial: false }).event as MatchEvent,
      gamjeomEvent('RED', { remainingMs: 30_000, requestSpecial: false }).event as MatchEvent,
    ]
    const outcome = resolveRoundOutcome(events, 1, RULE)
    expect(outcome.scores).toMatchObject({
      blueScore: 2,
      redScore: 2,
      blueGamjeom: 1,
      redGamjeom: 2,
    })
    expect(WT_2026_06_01_TRAINING.round.tieBreakUsesGamjeomCount).toBe(false)
    expect(outcome).toMatchObject({ winner: null, reason: null })
  })

  it('分數與旋轉分相同時，有技術得分者勝過只靠對手犯規得分者', () => {
    // 藍方 1 分來自正拳；紅方 1 分來自藍方的 Gam-jeom
    const events = [
      scoreEvent('BLUE', 'BODY_PUNCH'),
      gamjeomEvent('BLUE', { remainingMs: 40_000, requestSpecial: false }).event as MatchEvent,
    ]
    const outcome = resolveRoundOutcome(events, 1, RULE)
    expect(outcome.scores).toMatchObject({ blueScore: 1, redScore: 1 })
    expect(outcome).toMatchObject({ winner: 'BLUE', reason: 'HIGHER_TECHNIQUE' })
  })

  it('完全相同時不自行猜測，回傳 null 交由優勢判定', () => {
    const events = [scoreEvent('BLUE', 'BODY_KICK'), scoreEvent('RED', 'BODY_KICK')]
    expect(resolveRoundOutcome(events, 1, RULE)).toMatchObject({ winner: null, reason: null })
  })

  it('Gam-jeom 達上限仍然直接判給對手（與平手判定無關）', () => {
    const events = Array.from(
      { length: WT_2026_06_01_TRAINING.round.gamjeomLimitPerRound },
      () =>
        gamjeomEvent('BLUE', { remainingMs: 40_000, requestSpecial: false }).event as MatchEvent,
    )
    expect(resolveRoundOutcome(events, 1, RULE)).toMatchObject({
      winner: 'RED',
      reason: 'GAMJEOM_LIMIT',
    })
  })

  it('0:0 也視為平手，需優勢判定', () => {
    expect(resolveRoundOutcome([], 1, RULE)).toMatchObject({ winner: null })
  })

  it('三回合需 2 勝、五回合需 3 勝', () => {
    expect(roundWinsNeeded(3, RULE)).toBe(2)
    expect(roundWinsNeeded(5, RULE)).toBe(3)
  })

  it('分差門檻為 15；Gam-jeom 上限為 5', () => {
    expect(WT_2026_06_01_TRAINING.round.pointGapThreshold).toBe(15)
    expect(WT_2026_06_01_TRAINING.round.gamjeomLimitPerRound).toBe(5)
    expect(
      isPointGapReached({ blueScore: 15, redScore: 0, blueGamjeom: 0, redGamjeom: 0 }, RULE),
    ).toBe(true)
    expect(
      isPointGapReached({ blueScore: 14, redScore: 0, blueGamjeom: 0, redGamjeom: 0 }, RULE),
    ).toBe(false)
    expect(
      isGamjeomLimitReached({ blueScore: 0, redScore: 0, blueGamjeom: 5, redGamjeom: 0 }, RULE),
    ).toBe(true)
  })

  it('已被復原的得分不列入平手判定', () => {
    const turning = scoreEvent('BLUE', 'TURNING_BODY_KICK')
    const reversal = buildReversalEvent([turning], turning.id, {
      source: 'OPERATOR',
      createdBy: 'test',
      now: NOW,
      remainingMsAtEvent: 10_000,
    })
    if (!reversal.ok) throw new Error('unexpected')
    const events = [turning, reversal.event]
    expect(turningPointsInRound(events, 1, 'BLUE')).toBe(0)
  })
})

/* ================================================================== */
/* 復原與紀錄（對應驗算 #27–#29）                                      */
/* ================================================================== */

describe('復原與手動修正', () => {
  it('#27 復原後分數正確，且原始事件保留在紀錄中', () => {
    const e1 = scoreEvent('BLUE', 'HEAD_KICK')
    const e2 = scoreEvent('BLUE', 'BODY_KICK')
    const events = [e1, e2]
    expect(scoresOf(events).blueScore).toBe(5)

    const last = findLastReversibleEvent(events)
    expect(last?.id).toBe(e2.id)

    const result = buildReversalEvent(events, e2.id, {
      source: 'OPERATOR',
      createdBy: 'operator',
      now: NOW + 1_000,
      remainingMsAtEvent: 40_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const after = [...events, result.event]
    expect(scoresOf(after).blueScore).toBe(3)
    // 不得刪除原事件
    expect(after.filter((e) => e.id === e2.id)).toHaveLength(1)
    expect(result.event.reversedEventId).toBe(e2.id)
  })

  it('#28 同一事件不能被復原兩次', () => {
    const e1 = scoreEvent('RED', 'BODY_KICK')
    const first = buildReversalEvent([e1], e1.id, {
      source: 'OPERATOR',
      createdBy: 'op',
      now: NOW,
      remainingMsAtEvent: 1_000,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = buildReversalEvent([e1, first.event], e1.id, {
      source: 'OPERATOR',
      createdBy: 'op',
      now: NOW + 10,
      remainingMsAtEvent: 900,
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('ALREADY_REVERSED')
  })

  it('復原 Gam-jeom 時，分數與 Gam-jeom 次數都要正確回沖', () => {
    const { event } = gamjeomEvent('BLUE', { remainingMs: 5_000, requestSpecial: true })
    const g = event as MatchEvent
    expect(scoresOf([g])).toMatchObject({ redScore: 2, blueGamjeom: 1 })

    const reversal = buildReversalEvent([g], g.id, {
      source: 'OPERATOR',
      createdBy: 'op',
      now: NOW + 100,
      remainingMsAtEvent: 4_900,
    })
    expect(reversal.ok).toBe(true)
    if (!reversal.ok) return
    expect(scoresOf([g, reversal.event])).toMatchObject({
      redScore: 0,
      blueGamjeom: 0,
    })
  })

  it('復原事件本身不可再被復原，且沒有可復原事件時回傳失敗', () => {
    const e1 = scoreEvent('BLUE', 'BODY_PUNCH')
    const r = buildReversalEvent([e1], e1.id, {
      source: 'OPERATOR',
      createdBy: 'op',
      now: NOW,
      remainingMsAtEvent: 1_000,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const again = buildReversalEvent([e1, r.event], r.event.id, {
      source: 'OPERATOR',
      createdBy: 'op',
      now: NOW,
      remainingMsAtEvent: 1_000,
    })
    expect(again.ok).toBe(false)
    expect(findLastReversibleEvent([e1, r.event])).toBeNull()
  })

  it('#30 由完整事件列表重算比分（斷線重連後覆蓋本機狀態）', () => {
    const events = [
      scoreEvent('BLUE', 'BODY_KICK'),
      scoreEvent('RED', 'HEAD_KICK'),
      scoreEvent('BLUE', 'TURNING_HEAD_KICK'),
      gamjeomEvent('RED', { remainingMs: 30_000, requestSpecial: false }).event as MatchEvent,
    ]
    expect(scoresOf(events)).toEqual({
      blueScore: 9, // 2 + 6 + 1(對手 Gam-jeom)
      redScore: 3,
      blueGamjeom: 0,
      redGamjeom: 1,
    })
  })

  /*
   * 事件套用刻意是精確算術，不在這一層截斷。
   * 截斷會讓「套用事件 → 套用它的 REVERSAL」無法回到原狀態，
   * 被截掉的差額永遠找不回來。「分數不為負」改由 matchCore 在指令邊界保證。
   */
  it('事件套用是精確算術，不截斷；負值由 hasNegativeScore 偵測', () => {
    const e = scoreEvent('BLUE', 'BODY_PUNCH')
    const r = buildReversalEvent([e], e.id, {
      source: 'OPERATOR',
      createdBy: 'op',
      now: NOW,
      remainingMsAtEvent: 0,
    })
    if (!r.ok) throw new Error('unexpected')
    // 人工偽造第二筆復原（正常流程不可能，同一筆只能復原一次）
    const doubleReversal = [e, r.event, { ...r.event, id: 'x', reversedEventId: 'other' }]
    const scores = scoresOf(doubleReversal)

    expect(scores.blueScore).toBe(-1)
    expect(hasNegativeScore(scores)).toBe(true)
    expect(hasNegativeScore(scoresOf([e]))).toBe(false)
  })

  it('復原可逆：套用事件再復原，分數與原本完全相同', () => {
    const e = scoreEvent('BLUE', 'HEAD_KICK')
    const r = buildReversalEvent([e], e.id, {
      source: 'OPERATOR',
      createdBy: 'op',
      now: NOW,
      remainingMsAtEvent: 0,
    })
    if (!r.ok) throw new Error('unexpected')
    expect(scoresOf([e, r.event])).toEqual(scoresOf([]))
  })
})
