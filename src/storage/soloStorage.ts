import type { MatchState } from '../types'
import { computeScores } from '../rules/ruleEngine'

/**
 * 單機模式的本機保存。
 * 使用 localStorage（同步、離線可用、電視鏡射時不需要任何連線）。
 * 分數一律由事件列表重算，避免存到不一致的快照。
 */

const SOLO_KEY = 'tp-tkd-score-lite:solo:v1'
const SCHEMA_VERSION = 1

interface StoredSolo {
  schemaVersion: number
  savedAt: number
  state: MatchState
}

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage !== undefined
  } catch {
    return false
  }
}

export function saveSoloMatch(state: MatchState, now: number = Date.now()): void {
  if (!hasStorage()) return
  try {
    const payload: StoredSolo = { schemaVersion: SCHEMA_VERSION, savedAt: now, state }
    window.localStorage.setItem(SOLO_KEY, JSON.stringify(payload))
  } catch (error) {
    console.warn('[solo] 無法寫入本機儲存', error)
  }
}

export function loadSoloMatch(): { state: MatchState; savedAt: number } | null {
  if (!hasStorage()) return null
  try {
    const raw = window.localStorage.getItem(SOLO_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as StoredSolo
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null
    const state = parsed.state
    if (state?.config === undefined || !Array.isArray(state.events)) return null
    // 以事件列表重算分數，快照僅供顯示用
    return { state: { ...state, scores: computeScores(state.events) }, savedAt: parsed.savedAt }
  } catch (error) {
    console.warn('[solo] 本機資料損毀，已忽略', error)
    return null
  }
}

export function clearSoloMatch(): void {
  if (!hasStorage()) return
  try {
    window.localStorage.removeItem(SOLO_KEY)
  } catch {
    /* 忽略 */
  }
}
