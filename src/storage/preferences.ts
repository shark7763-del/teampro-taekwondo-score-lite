import { DEFAULT_RULE_SET_CODE } from '../rules/ruleSets'

/**
 * 跨比賽保存的偏好設定與「上一次比賽設定」。
 *
 * 與比賽狀態（soloStorage）分開存放，因此清除比賽紀錄
 * 不會遺失音效／震動偏好，比賽資料也不會被設定變更影響。
 */

const PREF_KEY = 'tp-tkd-score-lite:prefs:v1'
const PREF_SCHEMA_VERSION = 1

export interface MatchSetup {
  blueName: string
  redName: string
  totalRounds: number
  roundDurationMs: number
  restDurationMs: number
  ruleSetCode: string
}

export interface Preferences {
  soundEnabled: boolean
  vibrationEnabled: boolean
  lastSetup: MatchSetup
}

export const DEFAULT_SETUP: MatchSetup = {
  blueName: '藍方',
  redName: '紅方',
  totalRounds: 3,
  roundDurationMs: 90_000,
  restDurationMs: 30_000,
  ruleSetCode: DEFAULT_RULE_SET_CODE,
}

export const DEFAULT_PREFERENCES: Preferences = {
  soundEnabled: true,
  vibrationEnabled: true,
  lastSetup: DEFAULT_SETUP,
}

/** 快速時間選項（毫秒） */
export const ROUND_DURATION_PRESETS: readonly { ms: number; label: string }[] = [
  { ms: 30_000, label: '30 秒｜情境訓練' },
  { ms: 60_000, label: '60 秒｜短回合' },
  { ms: 90_000, label: '90 秒｜訓練賽' },
  { ms: 120_000, label: '120 秒｜標準回合' },
]

export const REST_DURATION_PRESETS: readonly { ms: number; label: string }[] = [
  { ms: 15_000, label: '15 秒' },
  { ms: 30_000, label: '30 秒' },
  { ms: 60_000, label: '60 秒' },
]

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage !== undefined
  } catch {
    return false
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 讀取偏好設定。
 * 任何欄位缺失、型別錯誤或 JSON 損毀都會退回預設值，絕不拋出例外造成白畫面。
 */
export function loadPreferences(): Preferences {
  if (!hasStorage()) return { ...DEFAULT_PREFERENCES, lastSetup: { ...DEFAULT_SETUP } }
  try {
    const raw = window.localStorage.getItem(PREF_KEY)
    if (raw === null) return { ...DEFAULT_PREFERENCES, lastSetup: { ...DEFAULT_SETUP } }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_PREFERENCES, lastSetup: { ...DEFAULT_SETUP } }
    }
    const record = parsed as Record<string, unknown>
    const setupRecord = (record.lastSetup ?? {}) as Record<string, unknown>

    return {
      soundEnabled: typeof record.soundEnabled === 'boolean' ? record.soundEnabled : true,
      vibrationEnabled:
        typeof record.vibrationEnabled === 'boolean' ? record.vibrationEnabled : true,
      lastSetup: {
        blueName:
          typeof setupRecord.blueName === 'string' && setupRecord.blueName.trim() !== ''
            ? setupRecord.blueName
            : DEFAULT_SETUP.blueName,
        redName:
          typeof setupRecord.redName === 'string' && setupRecord.redName.trim() !== ''
            ? setupRecord.redName
            : DEFAULT_SETUP.redName,
        totalRounds: isFiniteNumber(setupRecord.totalRounds)
          ? clamp(Math.round(setupRecord.totalRounds), 1, 5)
          : DEFAULT_SETUP.totalRounds,
        roundDurationMs: isFiniteNumber(setupRecord.roundDurationMs)
          ? clamp(Math.round(setupRecord.roundDurationMs), 10_000, 600_000)
          : DEFAULT_SETUP.roundDurationMs,
        restDurationMs: isFiniteNumber(setupRecord.restDurationMs)
          ? clamp(Math.round(setupRecord.restDurationMs), 0, 300_000)
          : DEFAULT_SETUP.restDurationMs,
        ruleSetCode:
          typeof setupRecord.ruleSetCode === 'string'
            ? setupRecord.ruleSetCode
            : DEFAULT_SETUP.ruleSetCode,
      },
    }
  } catch (error) {
    console.warn('[prefs] 偏好設定損毀，已使用預設值', error)
    return { ...DEFAULT_PREFERENCES, lastSetup: { ...DEFAULT_SETUP } }
  }
}

export function savePreferences(prefs: Preferences): void {
  if (!hasStorage()) return
  try {
    window.localStorage.setItem(
      PREF_KEY,
      JSON.stringify({ schemaVersion: PREF_SCHEMA_VERSION, ...prefs }),
    )
  } catch (error) {
    console.warn('[prefs] 無法寫入偏好設定', error)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
