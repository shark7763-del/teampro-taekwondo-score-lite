import type { MatchState } from '../types'
import type { RoomConfig } from './roomTypes'
import { ROOM_TTL_MS } from './roomTypes'
import { computeRoundScores } from '../rules/ruleEngine'

/**
 * 房間資料的本機保存（mock adapter）。
 * 第三階段換成 Supabase 時，只需替換本檔與 roomChannel，頁面完全不用改。
 */

const ROOM_KEY = (code: string): string => `tp-tkd-score-lite:room:${code}`
const ROOM_INDEX_KEY = 'tp-tkd-score-lite:rooms'
const DEVICE_KEY = 'tp-tkd-score-lite:deviceId'
const SCHEMA_VERSION = 1

interface StoredRoom {
  schemaVersion: number
  config: RoomConfig
  match: MatchState
}

/** 房間代碼：6 碼，去掉容易看錯的 0/O/1/I，方便現場口述 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateRoomCode(): string {
  let code = ''
  const random = new Uint32Array(6)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(random)
  } else {
    for (let i = 0; i < 6; i += 1) random[i] = Math.floor(Math.random() * 0xffffffff)
  }
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[(random[i] ?? 0) % CODE_ALPHABET.length]
  }
  return code
}

/** 本機裝置識別碼，重新整理後保持不變（用於在線狀態與冷卻判斷） */
export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY)
    if (existing !== null && existing !== '') return existing
    const created = `dev-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function saveRoom(config: RoomConfig, match: MatchState): void {
  try {
    const payload: StoredRoom = { schemaVersion: SCHEMA_VERSION, config, match }
    window.localStorage.setItem(ROOM_KEY(config.roomCode), JSON.stringify(payload))
    const index = listRoomCodes()
    if (!index.includes(config.roomCode)) {
      window.localStorage.setItem(
        ROOM_INDEX_KEY,
        JSON.stringify([config.roomCode, ...index].slice(0, 20)),
      )
    }
  } catch (error) {
    console.warn('[room] 無法保存房間', error)
  }
}

export function loadRoom(code: string): { config: RoomConfig; match: MatchState } | null {
  try {
    const raw = window.localStorage.getItem(ROOM_KEY(code.toUpperCase()))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as StoredRoom
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null
    if (parsed.config?.roomCode === undefined || parsed.match?.config === undefined) return null
    if (Date.now() > parsed.config.expiresAt) return null
    return {
      config: parsed.config,
      // 分數一律由事件重算，避免存到不一致的快照
      match: {
        ...parsed.match,
        scores: computeRoundScores(parsed.match.events, parsed.match.currentRound),
      },
    }
  } catch (error) {
    console.warn('[room] 房間資料損毀', error)
    return null
  }
}

export function listRoomCodes(): string[] {
  try {
    const raw = window.localStorage.getItem(ROOM_INDEX_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : []
  } catch {
    return []
  }
}

export function createRoomConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  const now = Date.now()
  return {
    roomCode: generateRoomCode(),
    judgeMode: 'DUAL',
    confirmationWindowMs: 1_000,
    createdAt: now,
    expiresAt: now + ROOM_TTL_MS,
    ...overrides,
  }
}

export function isRoomExpired(config: RoomConfig, now: number = Date.now()): boolean {
  return now > config.expiresAt
}
