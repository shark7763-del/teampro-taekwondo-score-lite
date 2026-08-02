import type {
  ActionType,
  AthleteSide,
  BaseActionType,
  EventSource,
  GamjeomReason,
  MatchEvent,
  MatchStatus,
  RejectionReason,
  RoundWinReason,
  Scores,
  TurningActionType,
} from '../types'
import { getRuleSet, type RuleSetDefinition } from './ruleSets'

/* ------------------------------------------------------------------ */
/* 基本工具                                                            */
/* ------------------------------------------------------------------ */

export function opponentOf(side: AthleteSide): AthleteSide {
  return side === 'BLUE' ? 'RED' : 'BLUE'
}

export const EMPTY_SCORES: Readonly<Scores> = {
  blueScore: 0,
  redScore: 0,
  blueGamjeom: 0,
  redGamjeom: 0,
}

const TURNING_ACTIONS: readonly TurningActionType[] = ['TURNING_BODY_KICK', 'TURNING_HEAD_KICK']

export function isTurningAction(action: ActionType): action is TurningActionType {
  return (TURNING_ACTIONS as readonly ActionType[]).includes(action)
}

export function isBaseAction(action: ActionType): action is BaseActionType {
  return !isTurningAction(action)
}

/** 本次攻擊是否為踢擊（正拳不是） */
export function isKickAction(action: ActionType): boolean {
  return action !== 'BODY_PUNCH'
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/* ------------------------------------------------------------------ */
/* 分值換算：唯一真理來源                                              */
/* ------------------------------------------------------------------ */

/**
 * 取得某技術的正式分值。
 * 旋轉技術 = 對應基本技術分 × turningMultiplier（2026 規則的倍數制）。
 */
export function pointsForAction(action: ActionType, ruleSetCode?: string): number {
  const rules = getRuleSet(ruleSetCode)
  if (isTurningAction(action)) {
    const base = rules.turningBaseOf[action]
    return rules.basePoints[base] * rules.turningMultiplier
  }
  return rules.basePoints[action]
}

export interface ActionDescriptor {
  action: ActionType
  points: number
  label: string
  shortLabel: string
}

/** 提供給裁判端／單機端排列按鈕，順序固定，避免誤觸 */
export function listActions(ruleSetCode?: string): ActionDescriptor[] {
  const order: ActionType[] = [
    'BODY_PUNCH',
    'BODY_KICK',
    'HEAD_KICK',
    'TURNING_BODY_KICK',
    'TURNING_HEAD_KICK',
  ]
  const labels: Record<ActionType, { label: string; short: string }> = {
    BODY_PUNCH: { label: '身體正拳', short: '拳' },
    BODY_KICK: { label: '身體踢擊', short: '身體' },
    HEAD_KICK: { label: '頭部踢擊', short: '頭部' },
    TURNING_BODY_KICK: { label: '旋轉身體', short: '旋身' },
    TURNING_HEAD_KICK: { label: '旋轉頭部', short: '旋頭' },
  }
  return order.map((action) => ({
    action,
    points: pointsForAction(action, ruleSetCode),
    label: labels[action].label,
    shortLabel: labels[action].short,
  }))
}

/**
 * PSS 模擬模式的分數拆解（第一版僅供規則層與測試使用，UI 為第二版）。
 * - 踢擊：護具自動判定基本分，旋轉部分由裁判追加
 * - 正拳：一律由裁判確認
 */
export interface PssBreakdown {
  pssAutoPoints: number
  judgeAdditionalPoints: number
  totalPoints: number
}

export function pssBreakdown(action: ActionType, ruleSetCode?: string): PssBreakdown {
  const rules = getRuleSet(ruleSetCode)
  if (action === 'BODY_PUNCH') {
    return {
      pssAutoPoints: 0,
      judgeAdditionalPoints: rules.pss.judgePunchPoints,
      totalPoints: rules.pss.judgePunchPoints,
    }
  }
  if (isTurningAction(action)) {
    const base = rules.turningBaseOf[action]
    const auto = rules.pss.autoBase[base]
    const total = pointsForAction(action, ruleSetCode)
    return { pssAutoPoints: auto, judgeAdditionalPoints: total - auto, totalPoints: total }
  }
  const auto = rules.pss.autoBase[action as 'BODY_KICK' | 'HEAD_KICK']
  return { pssAutoPoints: auto, judgeAdditionalPoints: 0, totalPoints: auto }
}

/**
 * PSS 模擬模式：旋轉追加分是否可以成立。
 * 必須在同一方、回溯時間內已存在有效的基本踢擊得分事件，
 * 否則不得單獨增加旋轉追加分。
 */
export function canApplyTurningBonus(
  events: readonly MatchEvent[],
  side: AthleteSide,
  now: number,
  ruleSetCode?: string,
): { allowed: boolean; reason?: RejectionReason } {
  const rules = getRuleSet(ruleSetCode)
  if (!rules.pss.turningBonusRequiresBaseKick) return { allowed: true }

  const reversedIds = new Set(
    events.filter((e) => e.type === 'REVERSAL' && e.reversedEventId).map((e) => e.reversedEventId),
  )
  const hasBaseKick = events.some(
    (e) =>
      e.type === 'SCORE' &&
      e.athleteSide === side &&
      e.actionType !== null &&
      isKickAction(e.actionType) &&
      isBaseAction(e.actionType) &&
      !reversedIds.has(e.id) &&
      now - e.createdAt <= rules.pss.turningBonusLookbackMs,
  )
  return hasBaseKick
    ? { allowed: true }
    : { allowed: false, reason: 'NO_BASE_KICK_FOR_TURNING_BONUS' }
}

/* ------------------------------------------------------------------ */
/* Gam-jeom                                                            */
/* ------------------------------------------------------------------ */

export interface GamjeomContext {
  /** 被判罰的一方 */
  penalizedSide: AthleteSide
  reason: GamjeomReason
  /** 使用者是否按下「最後 10 秒消極」專用按鈕 */
  requestSpecial: boolean
  remainingMs: number
  matchStatus: MatchStatus
  enableLast10sGamjeom: boolean
  ruleSetCode?: string
}

export interface GamjeomResolution {
  allowed: boolean
  rejection?: RejectionReason
  /** 對手獲得的分數 */
  opponentPoints: number
  /** 是否為最後 N 秒加重處罰 */
  isSpecial: boolean
}

/**
 * 判定 Gam-jeom 的結果。
 *
 * 一般 Gam-jeom：對手 +1，受罰方 Gam-jeom +1。
 * 最後 10 秒消極 Gam-jeom：對手 +2，受罰方 Gam-jeom 仍然只 +1，
 * 且不得再另外加一般的 1 分（本函式只回傳單一結果，從結構上杜絕重複加分）。
 */
export function resolveGamjeom(ctx: GamjeomContext): GamjeomResolution {
  const rules: RuleSetDefinition = getRuleSet(ctx.ruleSetCode)
  const normal = rules.gamjeom.normalOpponentPoints

  if (ctx.matchStatus === 'FINISHED') {
    return { allowed: false, rejection: 'MATCH_FINISHED', opponentPoints: 0, isSpecial: false }
  }

  if (!ctx.requestSpecial) {
    return { allowed: true, opponentPoints: normal, isSpecial: false }
  }

  if (!ctx.enableLast10sGamjeom) {
    return { allowed: true, opponentPoints: normal, isSpecial: false }
  }

  const withinWindow = isWithinLastSeconds(ctx.remainingMs, ctx.ruleSetCode)
  const reasonQualifies = rules.gamjeom.lastSecondsReasons.includes(ctx.reason)
  const running = ctx.matchStatus === 'RUNNING'

  if (!running || !withinWindow || !reasonQualifies) {
    return {
      allowed: false,
      rejection: 'NOT_LAST_10_SECONDS',
      opponentPoints: 0,
      isSpecial: false,
    }
  }

  return {
    allowed: true,
    opponentPoints: rules.gamjeom.lastSecondsOpponentPoints,
    isSpecial: true,
  }
}

/** 是否落在回合最後 N 秒（含邊界值 10.000 秒） */
export function isWithinLastSeconds(remainingMs: number, ruleSetCode?: string): boolean {
  const rules = getRuleSet(ruleSetCode)
  return remainingMs > 0 && remainingMs <= rules.gamjeom.lastSecondsWindowMs
}

/* ------------------------------------------------------------------ */
/* 事件 → 分數                                                         */
/* ------------------------------------------------------------------ */

/**
 * 套用單一事件到分數上。
 * 這是全系統唯一解讀 athleteSide / pointsDelta / gamjeomDelta 語意的地方。
 */
export function applyEventToScores(scores: Scores, event: MatchEvent): Scores {
  const next: Scores = { ...scores }

  if (event.type === 'GAMJEOM') {
    // athleteSide = 受罰方；分數加給對手
    const gainer = opponentOf(event.athleteSide)
    addPoints(next, gainer, event.pointsDelta)
    addGamjeom(next, event.athleteSide, event.gamjeomDelta)
    return next
  }

  if (event.type === 'REVERSAL') {
    // 復原事件在建立時已算好相反的 delta，套用語意需與「被復原事件」相同
    if (event.reversedEventType === 'GAMJEOM') {
      const gainer = opponentOf(event.athleteSide)
      addPoints(next, gainer, event.pointsDelta)
      addGamjeom(next, event.athleteSide, event.gamjeomDelta)
      return next
    }
    addPoints(next, event.athleteSide, event.pointsDelta)
    addGamjeom(next, event.athleteSide, event.gamjeomDelta)
    return next
  }

  // SCORE / MANUAL_ADJUSTMENT：athleteSide = 分數變動的一方
  addPoints(next, event.athleteSide, event.pointsDelta)
  addGamjeom(next, event.athleteSide, event.gamjeomDelta)
  return next
}

function addPoints(scores: Scores, side: AthleteSide, delta: number): void {
  if (side === 'BLUE') scores.blueScore = Math.max(0, scores.blueScore + delta)
  else scores.redScore = Math.max(0, scores.redScore + delta)
}

function addGamjeom(scores: Scores, side: AthleteSide, delta: number): void {
  if (side === 'BLUE') scores.blueGamjeom = Math.max(0, scores.blueGamjeom + delta)
  else scores.redGamjeom = Math.max(0, scores.redGamjeom + delta)
}

/** 由完整事件列表重算分數。斷線重連後一律用此函式覆蓋本機狀態。 */
export function computeScores(events: readonly MatchEvent[]): Scores {
  let scores: Scores = { ...EMPTY_SCORES }
  for (const event of events) {
    scores = applyEventToScores(scores, event)
  }
  return scores
}

/**
 * 計算「單一回合」的分數。
 *
 * ⚠️ 三回合兩勝制下，每回合分數獨立歸零重新計算，
 * 因此除了紀錄與統計之外，所有顯示與勝負判定都必須使用本函式，
 * 不可把各回合分數加總。
 */
export function computeRoundScores(events: readonly MatchEvent[], round: number): Scores {
  return computeScores(events.filter((e) => e.round === round))
}

/* ------------------------------------------------------------------ */
/* 回合勝負判定（三回合兩勝制）                                        */
/* ------------------------------------------------------------------ */

export interface RoundOutcome {
  winner: AthleteSide | null
  reason: RoundWinReason | null
  scores: Scores
}

/** 該回合中，某一方由旋轉技術取得的分數 */
export function turningPointsInRound(
  events: readonly MatchEvent[],
  round: number,
  side: AthleteSide,
): number {
  const reversed = reversedEventIds(events)
  return events
    .filter(
      (e) =>
        e.round === round &&
        e.type === 'SCORE' &&
        e.athleteSide === side &&
        e.actionType !== null &&
        isTurningAction(e.actionType) &&
        !reversed.has(e.id),
    )
    .reduce((sum, e) => sum + e.pointsDelta, 0)
}

/** 該回合中，某一方各種分值技術的成立次數（key 為分值） */
export function techniqueCountsInRound(
  events: readonly MatchEvent[],
  round: number,
  side: AthleteSide,
): Map<number, number> {
  const reversed = reversedEventIds(events)
  const counts = new Map<number, number>()
  for (const e of events) {
    if (e.round !== round) continue
    if (e.type !== 'SCORE') continue
    if (e.athleteSide !== side) continue
    if (reversed.has(e.id)) continue
    counts.set(e.pointsDelta, (counts.get(e.pointsDelta) ?? 0) + 1)
  }
  return counts
}

/**
 * 判定一個回合的勝負。
 *
 * 判定順序（依 WT 三回合兩勝制）：
 * 1. 該回合累積 Gam-jeom 達上限（預設 5 次）→ 對手直接贏得該回合
 * 2. 分數較高者勝
 * 3. 分數相同 → 旋轉技術得分較多者勝
 * 4. 仍相同 → 高分值技術數量較多者勝（3 分 → 2 分 → 1 分）
 * 5. 仍相同 → 回傳 winner = null，交由主控／主審依優勢判定
 *
 * ⚠️ 與正式賽的差異（兩者皆已於 README 標示）：
 *    - 正式賽在第 4 步之後另有「PSS 登錄擊中次數」，
 *      本系統為無電子護具模式無此資料，故略過。
 *    - 正式賽接著比「Gam-jeom 較少者勝」，本訓練系統預設關閉
 *      （rules.round.tieBreakUsesGamjeomCount = false），
 *      改為直接交由主控判定，符合訓練賽現場的實際需求。
 */
export function resolveRoundOutcome(
  events: readonly MatchEvent[],
  round: number,
  ruleSetCode?: string,
): RoundOutcome {
  const rules = getRuleSet(ruleSetCode)
  const scores = computeRoundScores(events, round)

  // 1. Gam-jeom 達上限
  const limit = rules.round.gamjeomLimitPerRound
  if (scores.blueGamjeom >= limit && scores.redGamjeom < limit) {
    return { winner: 'RED', reason: 'GAMJEOM_LIMIT', scores }
  }
  if (scores.redGamjeom >= limit && scores.blueGamjeom < limit) {
    return { winner: 'BLUE', reason: 'GAMJEOM_LIMIT', scores }
  }

  // 2. 分數
  if (scores.blueScore !== scores.redScore) {
    return {
      winner: scores.blueScore > scores.redScore ? 'BLUE' : 'RED',
      reason: 'POINTS',
      scores,
    }
  }

  // 3. 旋轉技術得分
  const blueTurning = turningPointsInRound(events, round, 'BLUE')
  const redTurning = turningPointsInRound(events, round, 'RED')
  if (blueTurning !== redTurning) {
    return {
      winner: blueTurning > redTurning ? 'BLUE' : 'RED',
      reason: 'TURNING_POINTS',
      scores,
    }
  }

  // 4. 高分值技術數量（由高到低）
  const blueCounts = techniqueCountsInRound(events, round, 'BLUE')
  const redCounts = techniqueCountsInRound(events, round, 'RED')
  const values = [...new Set([...blueCounts.keys(), ...redCounts.keys()])].sort((a, b) => b - a)
  for (const value of values) {
    const blue = blueCounts.get(value) ?? 0
    const red = redCounts.get(value) ?? 0
    if (blue !== red) {
      return { winner: blue > red ? 'BLUE' : 'RED', reason: 'HIGHER_TECHNIQUE', scores }
    }
  }

  // 5. Gam-jeom 較少（訓練模式預設關閉，改為直接交給主控判定）
  if (rules.round.tieBreakUsesGamjeomCount && scores.blueGamjeom !== scores.redGamjeom) {
    return {
      winner: scores.blueGamjeom < scores.redGamjeom ? 'BLUE' : 'RED',
      reason: 'FEWER_GAMJEOM',
      scores,
    }
  }

  // 6. 需優勢判定
  return { winner: null, reason: null, scores }
}

/** 該回合是否已達分差門檻，應提前結束 */
export function isPointGapReached(scores: Scores, ruleSetCode?: string): boolean {
  const rules = getRuleSet(ruleSetCode)
  return Math.abs(scores.blueScore - scores.redScore) >= rules.round.pointGapThreshold
}

/** 該回合是否有一方 Gam-jeom 已達上限 */
export function isGamjeomLimitReached(scores: Scores, ruleSetCode?: string): boolean {
  const limit = getRuleSet(ruleSetCode).round.gamjeomLimitPerRound
  return scores.blueGamjeom >= limit || scores.redGamjeom >= limit
}

/** 三回合兩勝制需要贏幾個回合 */
export function roundWinsNeeded(totalRounds: number, ruleSetCode?: string): number {
  return getRuleSet(ruleSetCode).round.winsNeededOf(totalRounds)
}

const ROUND_REASON_LABEL: Record<RoundWinReason, string> = {
  POINTS: '分數領先',
  TURNING_POINTS: '旋轉技術得分較多',
  HIGHER_TECHNIQUE: '高分值技術較多',
  FEWER_GAMJEOM: 'Gam-jeom 較少',
  GAMJEOM_LIMIT: '對手 Gam-jeom 達上限',
  POINT_GAP: '分差達門檻',
  SUPERIORITY: '優勢判定',
}

export function roundReasonLabel(reason: RoundWinReason): string {
  return ROUND_REASON_LABEL[reason]
}

/* ------------------------------------------------------------------ */
/* 事件工廠                                                            */
/* ------------------------------------------------------------------ */

interface BaseEventInput {
  matchId: string
  round: number
  remainingMsAtEvent: number
  ruleSetCode: string
  source: EventSource
  createdBy: string
  now: number
}

export function buildScoreEvent(
  input: BaseEventInput & {
    athleteSide: AthleteSide
    actionType: ActionType
    matchedGroupId?: string | null
  },
): MatchEvent {
  return {
    id: createId(),
    matchId: input.matchId,
    type: 'SCORE',
    athleteSide: input.athleteSide,
    actionType: input.actionType,
    pointsDelta: pointsForAction(input.actionType, input.ruleSetCode),
    gamjeomDelta: 0,
    source: input.source,
    matchedGroupId: input.matchedGroupId ?? null,
    reversedEventId: null,
    reversedEventType: null,
    round: input.round,
    remainingMsAtEvent: input.remainingMsAtEvent,
    ruleSetCode: input.ruleSetCode,
    reason: null,
    note: null,
    createdBy: input.createdBy,
    createdAt: input.now,
  }
}

export function buildGamjeomEvent(
  input: BaseEventInput & {
    penalizedSide: AthleteSide
    reason: GamjeomReason
    opponentPoints: number
    isSpecial: boolean
  },
): MatchEvent {
  return {
    id: createId(),
    matchId: input.matchId,
    type: 'GAMJEOM',
    athleteSide: input.penalizedSide,
    actionType: null,
    pointsDelta: input.opponentPoints,
    // 最後 10 秒加重處罰仍然只記 1 次 Gam-jeom
    gamjeomDelta: 1,
    source: input.source,
    matchedGroupId: null,
    reversedEventId: null,
    reversedEventType: null,
    round: input.round,
    remainingMsAtEvent: input.remainingMsAtEvent,
    ruleSetCode: input.ruleSetCode,
    reason: input.reason,
    note: input.isSpecial ? 'LAST_10_SECONDS_PASSIVE' : null,
    createdBy: input.createdBy,
    createdAt: input.now,
  }
}

export function buildManualAdjustmentEvent(
  input: BaseEventInput & {
    athleteSide: AthleteSide
    pointsDelta: number
    note: string
  },
): MatchEvent {
  return {
    id: createId(),
    matchId: input.matchId,
    type: 'MANUAL_ADJUSTMENT',
    athleteSide: input.athleteSide,
    actionType: null,
    pointsDelta: input.pointsDelta,
    gamjeomDelta: 0,
    source: input.source,
    matchedGroupId: null,
    reversedEventId: null,
    reversedEventType: null,
    round: input.round,
    remainingMsAtEvent: input.remainingMsAtEvent,
    ruleSetCode: input.ruleSetCode,
    reason: null,
    note: input.note,
    createdBy: input.createdBy,
    createdAt: input.now,
  }
}

/** 已被復原過的事件 ID 集合 */
export function reversedEventIds(events: readonly MatchEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const e of events) {
    if (e.type === 'REVERSAL' && e.reversedEventId !== null) ids.add(e.reversedEventId)
  }
  return ids
}

/** 找出最後一筆可被復原的事件（尚未被復原、且本身不是 REVERSAL） */
export function findLastReversibleEvent(events: readonly MatchEvent[]): MatchEvent | null {
  const reversed = reversedEventIds(events)
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]
    if (e === undefined) continue
    if (e.type === 'REVERSAL') continue
    if (reversed.has(e.id)) continue
    return e
  }
  return null
}

export type ReversalResult =
  { ok: true; event: MatchEvent } | { ok: false; reason: RejectionReason | 'NOTHING_TO_REVERSE' }

/**
 * 建立復原事件。不刪除原事件，改以相反 delta 的 REVERSAL 事件修正比分。
 * 同一事件只能被復原一次。
 */
export function buildReversalEvent(
  events: readonly MatchEvent[],
  targetEventId: string,
  meta: { source: EventSource; createdBy: string; now: number; remainingMsAtEvent: number },
): ReversalResult {
  const target = events.find((e) => e.id === targetEventId)
  if (target === undefined) return { ok: false, reason: 'NOTHING_TO_REVERSE' }
  if (target.type === 'REVERSAL') return { ok: false, reason: 'NOTHING_TO_REVERSE' }
  if (reversedEventIds(events).has(targetEventId)) return { ok: false, reason: 'ALREADY_REVERSED' }

  return {
    ok: true,
    event: {
      id: createId(),
      matchId: target.matchId,
      type: 'REVERSAL',
      athleteSide: target.athleteSide,
      actionType: target.actionType,
      pointsDelta: -target.pointsDelta,
      gamjeomDelta: -target.gamjeomDelta,
      source: meta.source,
      matchedGroupId: null,
      reversedEventId: target.id,
      reversedEventType: target.type,
      round: target.round,
      remainingMsAtEvent: meta.remainingMsAtEvent,
      ruleSetCode: target.ruleSetCode,
      reason: target.type === 'GAMJEOM' ? target.reason : null,
      note: `復原：${describeEvent(target)}`,
      createdBy: meta.createdBy,
      createdAt: meta.now,
    },
  }
}

/* ------------------------------------------------------------------ */
/* 顯示用文字                                                          */
/* ------------------------------------------------------------------ */

const SIDE_LABEL: Record<AthleteSide, string> = { BLUE: '藍方', RED: '紅方' }
const REASON_LABEL: Record<GamjeomReason, string> = {
  OUT_OF_BOUNDS: '出界',
  FALLING_DOWN: '倒地',
  AVOIDING: '逃避對手',
  OTHER: '其他',
}

export function sideLabel(side: AthleteSide): string {
  return SIDE_LABEL[side]
}

export function reasonLabel(reason: GamjeomReason): string {
  return REASON_LABEL[reason]
}

/** 復原按鈕上的短描述，例如「藍方 +3」「紅方 GJ」 */
export function shortDescribeEvent(event: MatchEvent): string {
  const side = event.athleteSide === 'BLUE' ? '藍' : '紅'
  if (event.type === 'GAMJEOM') return `${side}方 GJ`
  if (event.type === 'MANUAL_ADJUSTMENT') return `${side}方 ${event.pointsDelta}`
  return `${side}方 +${event.pointsDelta}`
}

export function describeEvent(event: MatchEvent): string {
  if (event.type === 'SCORE' && event.actionType !== null) {
    const desc = listActions(event.ruleSetCode).find((a) => a.action === event.actionType)
    return `${SIDE_LABEL[event.athleteSide]} ${desc?.label ?? event.actionType} +${event.pointsDelta}`
  }
  if (event.type === 'GAMJEOM') {
    const special = event.note === 'LAST_10_SECONDS_PASSIVE' ? '（最後10秒消極）' : ''
    return `${SIDE_LABEL[event.athleteSide]} Gam-jeom${special}，${SIDE_LABEL[opponentOf(event.athleteSide)]} +${event.pointsDelta}`
  }
  if (event.type === 'MANUAL_ADJUSTMENT') {
    const sign = event.pointsDelta >= 0 ? '+' : ''
    return `${SIDE_LABEL[event.athleteSide]} 手動修正 ${sign}${event.pointsDelta}`
  }
  return event.note ?? '復原'
}
