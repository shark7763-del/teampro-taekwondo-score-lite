import type {
  ActionType,
  AthleteSide,
  EventSource,
  GamjeomReason,
  MatchConfig,
  MatchEvent,
  MatchState,
  RejectionReason,
} from '../types'
import {
  buildGamjeomEvent,
  buildManualAdjustmentEvent,
  buildReversalEvent,
  buildScoreEvent,
  computeScores,
  createId,
  EMPTY_SCORES,
  findLastReversibleEvent,
  resolveGamjeom,
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
  | { type: 'TIME_UP' }
  | { type: 'FINISH' }
  | { type: 'RESTART' }
  | { type: 'RENAME'; side: AthleteSide; name: string }
  | { type: 'SWAP_SIDES' }

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
    matchStatus: 'READY',
    timer: createTimer(config.roundDurationMs),
    events: [],
    updatedAt: now,
  }
}

function reject(state: MatchState, reason: CommandRejection): CommandResult {
  return { state, rejected: reason }
}

function withEvent(state: MatchState, event: MatchEvent, now: number): CommandResult {
  const events = [...state.events, event]
  return {
    state: { ...state, events, scores: computeScores(events), updatedAt: now },
    emitted: event,
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

    /* ---------------- 回合 ---------------- */
    case 'TIME_UP': {
      if (state.matchStatus === 'FINISHED') return { state }
      if (state.matchStatus === 'REST') {
        // 休息結束 → 進入下一回合待命
        return {
          state: {
            ...state,
            matchStatus: 'READY',
            timer: createTimer(state.config.roundDurationMs),
            updatedAt: now,
          },
        }
      }
      if (state.currentRound >= state.config.totalRounds) {
        return {
          state: {
            ...state,
            matchStatus: 'FINISHED',
            timer: { timerStatus: 'STOPPED', timerStartedAt: null, remainingMsAtStart: 0 },
            updatedAt: now,
          },
        }
      }
      return {
        state: {
          ...state,
          matchStatus: 'REST',
          currentRound: state.currentRound + 1,
          timer: startTimer(createTimer(state.config.restDurationMs), now),
          updatedAt: now,
        },
      }
    }

    case 'NEXT_ROUND': {
      if (state.currentRound >= state.config.totalRounds) {
        return {
          state: { ...state, matchStatus: 'FINISHED', updatedAt: now },
        }
      }
      return {
        state: {
          ...state,
          currentRound: state.currentRound + 1,
          matchStatus: 'READY',
          timer: createTimer(state.config.roundDurationMs),
          updatedAt: now,
        },
      }
    }

    case 'PREV_ROUND': {
      if (state.currentRound <= 1) return reject(state, 'INVALID_COMMAND')
      return {
        state: {
          ...state,
          currentRound: state.currentRound - 1,
          matchStatus: 'READY',
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
