import type { RoomMessage } from './roomTypes'

/**
 * 房間訊息通道（mock adapter）。
 *
 * 目前以 BroadcastChannel 在同一個瀏覽器的多個分頁之間傳遞訊息，
 * 介面刻意設計成之後可直接換成 Supabase Realtime：
 *   send(message) → channel.send({ type: 'broadcast', ... })
 *   subscribe(handler) → channel.on('broadcast', ...)
 *
 * ⚠️ 訊息通道永遠不是正式比分的來源。
 *    正式狀態一律由主控端（未來為資料庫）廣播的 STATE 決定。
 */
export interface RoomChannel {
  readonly available: boolean
  send: (message: RoomMessage) => void
  subscribe: (handler: (message: RoomMessage) => void) => () => void
  close: () => void
}

export function createRoomChannel(roomCode: string): RoomChannel {
  const name = `tp-tkd-room:${roomCode.toUpperCase()}`
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') {
    return {
      available: false,
      send: () => {},
      subscribe: () => () => {},
      close: () => {},
    }
  }

  let channel: BroadcastChannel | null = null
  try {
    channel = new window.BroadcastChannel(name)
  } catch {
    return { available: false, send: () => {}, subscribe: () => () => {}, close: () => {} }
  }

  return {
    available: true,
    send: (message) => {
      try {
        channel?.postMessage(message)
      } catch {
        /* 傳輸失敗不得影響本機狀態 */
      }
    },
    subscribe: (handler) => {
      const listener = (event: MessageEvent<RoomMessage>): void => {
        if (typeof event.data?.type !== 'string') return
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
