import type { JudgeMode, JudgeSeat, MatchState } from '../types'
import type { JudgePress, PressInput } from '../pairing/pairingEngine'
import type { PressOutcome } from '../types'

/**
 * 房間（多裝置模式）的型別定義。
 *
 * ⚠️ 第一版為 mock adapter：以 BroadcastChannel + localStorage 在
 *    「同一台裝置的同一個瀏覽器」內模擬多端連線，用來驗證整體流程與配對邏輯。
 *    真正的跨裝置連線需要 Supabase（第三階段），介面刻意與未來實作對齊。
 */

export type RoomRole = 'OPERATOR' | 'JUDGE' | 'DISPLAY'

export interface RoomConfig {
  roomCode: string
  /** 主控 PIN。⚠️ mock 模式存在本機，僅供流程驗證，不是真正的安全機制 */
  hostPin: string
  judgeMode: JudgeMode
  confirmationWindowMs: number
  createdAt: number
  expiresAt: number
}

export interface DevicePresence {
  deviceId: string
  role: RoomRole
  judgeSeat: JudgeSeat | null
  lastSeenAt: number
}

/** 主控端（本機模擬伺服器）廣播出去的完整狀態 */
export interface RoomSnapshot {
  roomCode: string
  sentAt: number
  config: RoomConfig
  match: MatchState
  presences: DevicePresence[]
}

export type RoomMessage =
  /** 客戶端上線，請求最新狀態 */
  | { type: 'HELLO'; deviceId: string; role: RoomRole; judgeSeat: JudgeSeat | null }
  /** 主控端廣播正式狀態（唯一的正式資料來源） */
  | { type: 'STATE'; snapshot: RoomSnapshot }
  /** 裁判送出按鍵 */
  | { type: 'PRESS'; input: PressInput }
  /** 主控端回覆該次按鍵的判定結果（只回給送出的裝置顯示，不含另一位裁判按了什麼） */
  | { type: 'PRESS_RESULT'; deviceId: string; clientEventId: string; outcome: PressOutcome }
  /** 心跳，用於在線狀態 */
  | { type: 'PING'; deviceId: string; role: RoomRole; judgeSeat: JudgeSeat | null }

export interface RoomRuntimeState {
  presses: JudgePress[]
}

export const ROOM_TTL_MS = 4 * 60 * 60 * 1_000
/** 超過這個時間沒有心跳就視為離線 */
export const PRESENCE_TIMEOUT_MS = 6_000
export const PRESENCE_PING_MS = 2_000
