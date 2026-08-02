import type { MatchState } from '../types'

/**
 * 顯示端同步的服務層（Service Layer）。
 *
 * 目的是把「比賽狀態」與「怎麼傳到另一個畫面」徹底分開，
 * 未來要接 WebSocket／Supabase Realtime 時，只需要新增一個
 * 實作 DisplaySyncTransport 的類別，控制端與顯示端元件都不用改。
 *
 * ⚠️ 本層只負責「傳遞畫面用的快照」，永遠不是正式比分的來源。
 *    Solo Mode 的正式比分一律是本機 MatchState + localStorage。
 *    任何傳輸失敗都不得影響計分，因此所有方法都不會拋出例外。
 */

export interface DisplaySnapshot {
  /** 快照版本，接收端可用來忽略過期訊息 */
  sentAt: number
  state: MatchState
}

export interface DisplaySyncTransport {
  readonly name: string
  publish: (snapshot: DisplaySnapshot) => void
  subscribe: (handler: (snapshot: DisplaySnapshot) => void) => () => void
  close: () => void
}

/** 什麼都不做的傳輸層：環境不支援時使用，確保 Solo Mode 完全不受影響 */
export function createNoopTransport(): DisplaySyncTransport {
  return {
    name: 'noop',
    publish: () => {},
    subscribe: () => () => {},
    close: () => {},
  }
}

/**
 * 同一台裝置、同一個瀏覽器的多視窗同步（例如筆電接投影機開兩個視窗）。
 * 不需要任何後端，也不會送出任何資料到網路上。
 */
export function createBroadcastTransport(channelName = 'tp-tkd-display'): DisplaySyncTransport {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') {
    return createNoopTransport()
  }
  let channel: BroadcastChannel | null = null
  try {
    channel = new window.BroadcastChannel(channelName)
  } catch {
    return createNoopTransport()
  }

  return {
    name: 'broadcast-channel',
    publish: (snapshot) => {
      try {
        channel?.postMessage(snapshot)
      } catch {
        /* 傳輸失敗不得影響計分 */
      }
    },
    subscribe: (handler) => {
      const listener = (event: MessageEvent<DisplaySnapshot>): void => {
        if (event.data?.state?.config === undefined) return
        handler(event.data)
      }
      channel?.addEventListener('message', listener)
      return () => channel?.removeEventListener('message', listener)
    },
    close: () => {
      try {
        channel?.close()
      } catch {
        /* 忽略 */
      }
      channel = null
    },
  }
}

/**
 * 未來的多裝置同步（房間碼 / QR Code / WebSocket）由此建立。
 * 第一版尚未實作，刻意回傳 noop 而不是假裝同步成功。
 */
export function createRoomTransport(): DisplaySyncTransport {
  return createNoopTransport()
}
