import type {
  ActionType,
  AthleteSide,
  EventSource,
  GamjeomReason,
  MatchConfig,
  MatchEvent,
  MatchState,
  RejectionReason,
  RoundResult,
  RoundWinReason,
} from '../types'
import {
  buildGamjeomEvent,
  buildManualAdjustmentEvent,
  buildReversalEvent,
  buildScoreEvent,
  computeRoundScores,
  createId,
  EMPTY_SCORES,
  findLastReversibleEvent,
  isGamjeomLimitReached,
  isPointGapReached,
  resolveGamjeom,
  resolveRoundOutcome,
  roundWinsNeeded,
} from '../rules/ruleEngine'
import { DEFAULT_RULE_SET_CODE, getRuleSet } from '../rules/ruleSets'
import {
  computeRemainingMs,
  createTimer,
  pauseTimer,
  setRemaining,
  startTimer,
} from '../timer/timer'

/**
 * 比賽狀態機（純函式）。
 *
 * 單機模式直接使用；連線模式的伺服器 RPC 會實作同一套判斷，
 * 前端則以此為樂觀顯示與離線備援，正式比分仍以資料庫為準。
 */

export type MatchCommand =
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'RESET_ROUND_TIME' }
  | { type: 'ADJUST_TIME'; deltaMs: number }
  | { type: 'SCORE'; side: AthleteSide; action: ActionType; source?: EventSource }
  | {
      type: 'GAMJEOM'
      side: AthleteSide
      reason: GamjeomReason
      special: boolean
      source?: EventSource
    }
  | { type: 'MANUAL_ADJUST'; side: AthleteSide; deltaPoints: number; note: string }
  | { type: 'UNDO' }
  | { type: 'REVERSE_EVENT'; eventId: string }
  | { type: 'NEXT_ROUND' }
  | { type: 'PREV_ROUND' }
  /** 回合平手且所有判定條件相同時，由主控／主審依優勢判定 */
  | { type: 'DECIDE_SUPERIORITY'; winner: AthleteSide }
  | { type: 'TIME_UP' }
  | { type: 'FINISH' }
  | { type: 'RESTART' }
  | { type: 'RENAME'; side: AthleteSide; name: string }
  | { type: 'SWAP_SIDES' }
  /** 更新音效／震動等即時偏好，不影響任何計分規則 */
  | { type: 'SET_OPTIONS'; soundEnabled?: boolean; vibrationEnabled?: boolean }

export type CommandRejection = RejectionReason | 'NOTHING_TO_REVERSE' | 'INVALID_COMMAND'

export interface CommandResult {
  state: MatchState
  /** 有值代表指令被拒絕，state 不變 */
  rejected?: CommandRejection
  /** 本次指令產生的事件（供動畫、音效、Broadcast 使用；非正式比分來源） */
  emitted?: MatchEvent
}

export const DEFAULT_MATCH_CONFIG: Omit<MatchConfig, 'matchId'> = {
  blueName: '藍方',
  redName: '紅方',
  totalRounds: 3,
  roundDurationMs: 90_000,
  restDurationMs: 30_000,
  scoringMode: 'NO_PSS',
  judgeMode: 'SINGLE',
  confirmationWindowMs: getRuleSet().trainingDefaults.confirmationWindowMs,
  soundEnabled: true,
  vibrationEnabled: true,
  allowScoreWhenPaused: false,
  enableLast10sGamjeom: true,
  ruleSetCode: DEFAULT_RULE_SET_CODE,
}

export function createMatchState(
  overrides: Partial<MatchConfig> = {},
  now: number = Date.now(),
): MatchState {
  const config: MatchConfig = {
    matchId: createId(),
    ...DEFAULT_MATCH_CONFIG,
    ...overrides,
  }
  return {
    config,
    scores: { ...EMPTY_SCORES },
    currentRound: 1,
    roundResults: [],
    roundWins: { blue: 0, red: 0 },
    matchStatus: 'READY',
    timer: createTimer(config.roundDurationMs),
    events: [],
    matchWinner: null,
    pendingSuperiorityRound: null,
    updatedAt: now,
  }
}

function reject(state: MatchState, reason: CommandRejection): CommandResult {
  return { state, rejected: reason }
}

/**
 * 加入一筆事件。
 *
 * ⚠️ 三回合兩勝制：`scores` 只代表「目前這一回合」的分數，每回合歸零。
 * 加入事件後會立即檢查「分差達門檻」與「Gam-jeom 達上限」，
 * 符合條件時該回合當場結束，不需等時間到。
 */
function withEvent(state: MatchState, event: MatchEvent, now: number): CommandResult {
  const events = [...state.events, event]
  const scores = computeRoundScores(events, state.currentRound)
  const next: MatchState = { ...state, events, scores, updatedAt: now }

  const ruleCode = state.config.ruleSetCode
  if (state.matchStatus === 'RUNNING' || state.matchStatus === 'PAUSED') {
    if (isGamjeomLimitReached(scores, ruleCode)) {
      return { state: finalizeRound(next, now), emitted: event }
    }
    if (isPointGapReached(scores, ruleCode)) {
      return { state: finalizeRound(next, now, 'POINT_GAP'), emitted: event }
    }
  }
  return { state: next, emitted: event }
}

/**
 * 結束目前回合並結算勝負。
 *
 * 平手且所有判定條件都相同時，回傳 `pendingSuperiorityRound`，
 * 由主控（正式賽為主審）依優勢判定，系統不自行猜測。
 */
function finalizeRound(
  state: MatchState,
  now: number,
  forcedReason?: RoundWinReason,
  forcedWinner?: AthleteSide,
): MatchState {
  const outcome = resolveRoundOutcome(state.events, state.currentRound, state.config.ruleSetCode)
  const winner = forcedWinner ?? outcome.winner

  if (winner === null) {
    return {
      ...state,
      matchStatus: 'PAUSED',
      timer: pauseTimer(state.timer, now),
      pendingSuperiorityRound: state.currentRound,
      updatedAt: now,
    }
  }

  const reason: RoundWinReason =
    forcedWinner !== undefined && outcome.winner === null
      ? 'SUPERIORITY'
      : (forcedReason ?? outcome.reason ?? 'POINTS')

  const result: RoundResult = {
    round: state.currentRound,
    blueScore: outcome.scores.blueScore,
    redScore: outcome.scores.redScore,
    blueGamjeom: outcome.scores.blueGamjeom,
    redGamjeom: outcome.scores.redGamjeom,
    winner,
    reason,
    decidedAt: now,
  }

  const roundWins = {
    blue: state.roundWins.blue + (winner === 'BLUE' ? 1 : 0),
    red: state.roundWins.red + (winner === 'RED' ? 1 : 0),
  }
  const roundResults = [...state.roundResults, result]
  const needed = roundWinsNeeded(state.config.totalRounds, state.config.ruleSetCode)

  const base: MatchState = {
    ...state,
    roundResults,
    roundWins,
    pendingSuperiorityRound: null,
    updatedAt: now,
  }

  // 先贏得所需回合數者獲勝 → 不再進行後續回合
  if (roundWins.blue >= needed || roundWins.red >= needed) {
    return {
      ...base,
      matchStatus: 'FINISHED',
      matchWinner: roundWins.blue >= needed ? 'BLUE' : 'RED',
      timer: pauseTimer(state.timer, now),
    }
  }

  // 回合已打完但無人達標（理論上只在自訂回合數時發生）
  if (state.currentRound >= state.config.totalRounds) {
    const matchWinner =
      roundWins.blue === roundWins.red ? null : roundWins.blue > roundWins.red ? 'BLUE' : 'RED'
    return {
      ...base,
      matchStatus: 'FINISHED',
      matchWinner,
      timer: pauseTimer(state.timer, now),
    }
  }

  // 進入回合間休息；下一回合分數重新歸零。
  // 休息倒數不自動起跑，由教練確認本回合結果後再按「開始休息倒數」，
  // 避免比賽在教練還沒看完比分時就自己往下跑。
  return {
    ...base,
    currentRound: state.currentRound + 1,
    scores: { ...EMPTY_SCORES },
    matchStatus: 'REST',
    timer: createTimer(state.config.restDurationMs),
  }
}

/** 得分是否可被接受（單機與伺服器共用同一組判斷） */
export function canAcceptScore(
  state: MatchState,
): { ok: true } | { ok: false; reason: RejectionReason } {
  if (state.matchStatus === 'FINISHED') return { ok: false, reason: 'MATCH_FINISHED' }
  if (state.matchStatus === 'RUNNING') return { ok: true }
  if (state.matchStatus === 'PAUSED' || state.matchStatus === 'REST') {
    return state.config.allowScoreWhenPaused ? { ok: true } : { ok: false, reason: 'MATCH_PAUSED' }
  }
  return { ok: false, reason: 'MATCH_NOT_RUNNING' }
}

export function reduceMatch(
  state: MatchState,
  command: MatchCommand,
  now: number = Date.now(),
): CommandResult {
  const remainingMs = computeRemainingMs(state.timer, now)
  const eventBase = {
    matchId: state.config.matchId,
    round: state.currentRound,
    remainingMsAtEvent: remainingMs,
    ruleSetCode: state.config.ruleSetCode,
    createdBy: 'local',
    now,
  }

  switch (command.type) {
    /* ---------------- 計時 ---------------- */
    case 'START':
    case 'RESUME': {
      if (state.matchStatus === 'FINISHED') return reject(state, 'MATCH_FINISHED')
      if (remainingMs <= 0) return reject(state, 'INVALID_COMMAND')
      return {
        state: {
          ...state,
          matchStatus: state.matchStatus === 'REST' ? 'REST' : 'RUNNING',
          timer: startTimer(state.timer, now),
          updatedAt: now,
        },
      }
    }

    case 'PAUSE': {
      if (state.timer.timerStatus !== 'RUNNING') return reject(state, 'INVALID_COMMAND')
      return {
        state: {
          ...state,
          matchStatus: state.matchStatus === 'REST' ? 'REST' : 'PAUSED',
          timer: pauseTimer(state.timer, now),
          updatedAt: now,
        },
      }
    }

    case 'RESET_ROUND_TIME': {
      if (state.matchStatus === 'FINISHED') return reject(state, 'MATCH_FINISHED')
      return {
        state: {
          ...state,
          matchStatus: 'READY',
          timer: createTimer(state.config.roundDurationMs),
          updatedAt: now,
        },
      }
    }

    case 'ADJUST_TIME': {
      if (state.matchStatus === 'FINISHED') return reject(state, 'MATCH_FINISHED')
      return {
        state: {
          ...state,
          timer: setRemaining(state.timer, remainingMs + command.deltaMs, now),
          updatedAt: now,
        },
      }
    }

    /* ---------------- 計分 ---------------- */
    case 'SCORE': {
      const gate = canAcceptScore(state)
      if (!gate.ok) return reject(state, gate.reason)
      const event = buildScoreEvent({
        ...eventBase,
        source: command.source ?? 'SOLO',
        athleteSide: command.side,
        actionType: command.action,
      })
      return withEvent(state, event, now)
    }

    case 'GAMJEOM': {
      const resolution = resolveGamjeom({
        penalizedSide: command.side,
        reason: command.reason,
        requestSpecial: command.special,
        remainingMs,
        matchStatus: state.matchStatus,
        enableLast10sGamjeom: state.config.enableLast10sGamjeom,
        ruleSetCode: state.config.ruleSetCode,
      })
      if (!resolution.allowed) {
        return reject(state, resolution.rejection ?? 'MATCH_NOT_RUNNING')
      }
      const event = buildGamjeomEvent({
        ...eventBase,
        source: command.source ?? 'OPERATOR',
        penalizedSide: command.side,
        reason: command.reason,
        opponentPoints: resolution.opponentPoints,
        isSpecial: resolution.isSpecial,
      })
      return withEvent(state, event, now)
    }

    case 'MANUAL_ADJUST': {
      if (state.matchStatus === 'FINISHED') return reject(state, 'MATCH_FINISHED')
      if (command.note.trim() === '') return reject(state, 'INVALID_COMMAND')
      const event = buildManualAdjustmentEvent({
        ...eventBase,
        source: 'OPERATOR',
        athleteSide: command.side,
        pointsDelta: command.deltaPoints,
        note: command.note.trim(),
      })
      return withEvent(state, event, now)
    }

    /* ---------------- 復原 ---------------- */
    case 'UNDO': {
      const target = findLastReversibleEvent(state.events)
      if (target === null) return reject(state, 'NOTHING_TO_REVERSE')
      return reduceMatch(state, { type: 'REVERSE_EVENT', eventId: target.id }, now)
    }

    case 'REVERSE_EVENT': {
      const result = buildReversalEvent(state.events, command.eventId, {
        source: 'OPERATOR',
        createdBy: 'local',
        now,
        remainingMsAtEvent: remainingMs,
      })
      if (!result.ok) return reject(state, result.reason)
      return withEvent(state, result.event, now)
    }

    /* ---------------- 回合（三回合兩勝制） ---------------- */
    case 'TIME_UP': {
      if (state.matchStatus === 'FINISHED') return { state }
      if (state.pendingSuperiorityRound !== null) return { state }
      if (state.matchStatus === 'REST') {
        // 休息結束 → 下一回合待命（分數已於結算時歸零）
        return {
          state: {
            ...state,
            matchStatus: 'READY',
            timer: createTimer(state.config.roundDurationMs),
            updatedAt: now,
          },
        }
      }
      // 回合時間到 → 結算本回合勝負
      return { state: finalizeRound(state, now) }
    }

    case 'NEXT_ROUND': {
      if (state.matchStatus === 'FINISHED') return reject(state, 'MATCH_FINISHED')
      if (state.pendingSuperiorityRound !== null) return reject(state, 'INVALID_COMMAND')
      if (state.matchStatus === 'REST') {
        return {
          state: {
            ...state,
            matchStatus: 'READY',
            timer: createTimer(state.config.roundDurationMs),
            updatedAt: now,
          },
        }
      }
      // 提前結束本回合並結算
      return { state: finalizeRound(state, now) }
    }

    case 'DECIDE_SUPERIORITY': {
      if (state.pendingSuperiorityRound === null) return reject(state, 'INVALID_COMMAND')
      return { state: finalizeRound(state, now, 'SUPERIORITY', command.winner) }
    }

    case 'PREV_ROUND': {
      // 回到上一回合：撤銷上一回合的結算，該回合的得分紀錄仍保留
      const last = state.roundResults.at(-1)
      if (last === undefined) return reject(state, 'INVALID_COMMAND')
      const roundResults = state.roundResults.slice(0, -1)
      return {
        state: {
          ...state,
          roundResults,
          roundWins: {
            blue: state.roundWins.blue - (last.winner === 'BLUE' ? 1 : 0),
            red: state.roundWins.red - (last.winner === 'RED' ? 1 : 0),
          },
          currentRound: last.round,
          scores: computeRoundScores(state.events, last.round),
          matchStatus: 'READY',
          matchWinner: null,
          pendingSuperiorityRound: null,
          timer: createTimer(state.config.roundDurationMs),
          updatedAt: now,
        },
      }
    }

    case 'FINISH': {
      return {
        state: {
          ...state,
          matchStatus: 'FINISHED',
          timer: pauseTimer(state.timer, now),
          updatedAt: now,
        },
      }
    }

    case 'RESTART': {
      // 沿用同一組設定與選手姓名，但視為全新一場比賽（新的 matchId 與空事件紀錄）
      return { state: createMatchState({ ...state.config, matchId: createId() }, now) }
    }

    /* ---------------- 名稱 ---------------- */
    case 'RENAME': {
      const name = command.name.trim().slice(0, 12)
      const config: MatchConfig =
        command.side === 'BLUE'
          ? { ...state.config, blueName: name === '' ? '藍方' : name }
          : { ...state.config, redName: name === '' ? '紅方' : name }
      return { state: { ...state, config, updatedAt: now } }
    }

    case 'SET_OPTIONS': {
      return {
        state: {
          ...state,
          config: {
            ...state.config,
            soundEnabled: command.soundEnabled ?? state.config.soundEnabled,
            vibrationEnabled: command.vibrationEnabled ?? state.config.vibrationEnabled,
          },
          updatedAt: now,
        },
      }
    }

    case 'SWAP_SIDES': {
      return {
        state: {
          ...state,
          config: {
            ...state.config,
            blueName: state.config.redName,
            redName: state.config.blueName,
          },
          updatedAt: now,
        },
      }
    }

    default:
      return reject(state, 'INVALID_COMMAND')
  }
}

/** 依序套用多個指令，測試與離線重放用 */
export function applyCommands(
  state: MatchState,
  commands: readonly MatchCommand[],
  startNow: number,
  stepMs = 0,
): MatchState {
  let current = state
  let now = startNow
  for (const command of commands) {
    current = reduceMatch(current, command, now).state
    now += stepMs
  }
  return current
}
