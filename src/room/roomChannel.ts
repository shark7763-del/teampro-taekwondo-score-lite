import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabaseClient } from '../lib/supabaseClient'
import type { RoomMessage } from './roomTypes'

/**
 * 房間訊息通道。
 *
 * 兩種傳輸方式，介面完全相同，頁面不需要知道目前用的是哪一種：
 *  - `cloud`：Supabase Realtime Broadcast。**真正的跨裝置**，電視、手機、
 *    裁判手機可以在不同網路，延遲約 100ms。需要 VITE_SUPABASE_* 環境變數。
 *  - `local`：BroadcastChannel。僅限**同一台裝置的同一個瀏覽器**多分頁，
 *    未設定 Supabase 時自動退回，方便本機開發與展示。
 *
 * ⚠️ 訊息通道永遠不是正式比分的來源。
 *    正式狀態一律由主控端廣播的 STATE 決定。
 */

export type RoomTransport = 'cloud' | 'local' | 'none'

export interface RoomChannel {
  readonly transport: RoomTransport
  send: (message: RoomMessage) => void
  subscribe: (handler: (message: RoomMessage) => void) => () => void
  /** 傳輸層是否已就緒（cloud 模式代表 Realtime 已訂閱成功） */
  onReady: (handler: (ready: boolean) => void) => () => void
  close: () => void
}

const BROADCAST_EVENT = 'room'
/** 尚未連線成功時最多暫存幾則訊息，避免離線時堆積過期的完整狀態 */
const MAX_QUEUE = 8

/**
 * 卸載後保留連線的寬限期。
 *
 * React StrictMode 在開發模式會「掛載 → 卸載 → 再掛載」。若卸載時立刻關閉，
 * 第二次掛載會用**同一個 topic** 再開一個 Supabase 頻道，
 * 而同一條 Realtime 連線上的同名頻道，第二個永遠不會進入 SUBSCRIBED
 * （已用 Node 實測確認），畫面就會一直卡在「雲端連線中…」。
 */
const CLOSE_GRACE_MS = 300

function channelName(roomCode: string): string {
  return `tp-tkd-score-lite-${roomCode.toUpperCase()}`
}

/** 目前會採用哪一種傳輸；純查詢，不會建立連線 */
export function expectedTransport(): RoomTransport {
  if (getSupabaseClient() !== null) return 'cloud'
  if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') return 'local'
  return 'none'
}

export function createRoomChannel(roomCode: string): RoomChannel {
  return acquireCloudChannel(roomCode) ?? createLocalChannel(roomCode)
}

/* ------------------------------------------------------------------ */
/* 雲端頻道以房間代碼共用並計數                                        */
/*                                                                     */
/* 本機（BroadcastChannel）刻意不共用：同一個分頁內的兩個              */
/* BroadcastChannel 物件本來就收得到彼此，那正是本機模擬所需要的行為。 */
/* ------------------------------------------------------------------ */

interface SharedChannel {
  channel: RoomChannel
  refs: number
  closeTimer: ReturnType<typeof setTimeout> | null
}

const cloudChannels = new Map<string, SharedChannel>()

function acquireCloudChannel(roomCode: string): RoomChannel | null {
  const key = channelName(roomCode)
  let entry = cloudChannels.get(key)

  if (entry === undefined) {
    const created = createCloudChannel(roomCode)
    if (created === null) return null
    entry = { channel: created, refs: 0, closeTimer: null }
    cloudChannels.set(key, entry)
  }

  if (entry.closeTimer !== null) {
    clearTimeout(entry.closeTimer)
    entry.closeTimer = null
  }
  entry.refs += 1

  const target = entry.channel
  const detachers: (() => void)[] = []
  let released = false

  return {
    transport: target.transport,
    send: (message) => {
      if (!released) target.send(message)
    },
    subscribe: (handler) => {
      const detach = target.subscribe(handler)
      detachers.push(detach)
      return detach
    },
    onReady: (handler) => {
      const detach = target.onReady(handler)
      detachers.push(detach)
      return detach
    },
    close: () => {
      if (released) return
      released = true
      for (const detach of detachers) detach()
      detachers.length = 0

      const current = cloudChannels.get(key)
      if (current === undefined) return
      current.refs -= 1
      if (current.refs > 0) return

      current.closeTimer = setTimeout(() => {
        if (current.refs > 0) return
        cloudChannels.delete(key)
        current.channel.close()
      }, CLOSE_GRACE_MS)
    },
  }
}

/* ================================================================== */
/* Supabase Realtime Broadcast（跨裝置）                               */
/* ================================================================== */

function createCloudChannel(roomCode: string): RoomChannel | null {
  const supabase = getSupabaseClient()
  if (supabase === null) return null

  const handlers = new Set<(message: RoomMessage) => void>()
  const readyHandlers = new Set<(ready: boolean) => void>()
  const queue: RoomMessage[] = []
  let ready = false
  let closed = false

  const channel: RealtimeChannel = supabase.channel(channelName(roomCode), {
    // self: false 讓語意與 BroadcastChannel 一致：不會收到自己送出的訊息
    config: { broadcast: { self: false } },
  })

  channel.on('broadcast', { event: BROADCAST_EVENT }, (payload: { payload?: unknown }) => {
    const message = payload.payload
    if (typeof message !== 'object' || message === null) return
    if (typeof (message as { type?: unknown }).type !== 'string') return
    for (const handler of handlers) handler(message as RoomMessage)
  })

  const setReady = (next: boolean): void => {
    if (ready === next) return
    ready = next
    for (const handler of readyHandlers) handler(next)
  }

  const push = (message: RoomMessage): void => {
    void channel
      .send({ type: 'broadcast', event: BROADCAST_EVENT, payload: message })
      .catch((error: unknown) => {
        console.warn('[room] 廣播失敗', error)
      })
  }

  channel.subscribe((status, error) => {
    if (closed) return
    if (status === 'SUBSCRIBED') {
      setReady(true)
      while (queue.length > 0) {
        const pending = queue.shift()
        if (pending !== undefined) push(pending)
      }
      return
    }
    setReady(false)
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[room] Realtime 連線異常（${status}）`, error)
    }
  })

  return {
    transport: 'cloud',
    send: (message) => {
      if (closed) return
      if (!ready) {
        queue.push(message)
        if (queue.length > MAX_QUEUE) queue.shift()
        return
      }
      push(message)
    },
    subscribe: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    onReady: (handler) => {
      readyHandlers.add(handler)
      handler(ready)
      return () => readyHandlers.delete(handler)
    },
    close: () => {
      closed = true
      handlers.clear()
      readyHandlers.clear()
      void supabase.removeChannel(channel)
    },
  }
}

/* ================================================================== */
/* BroadcastChannel（同瀏覽器多分頁，未設定 Supabase 時的退路）        */
/* ================================================================== */

function createLocalChannel(roomCode: string): RoomChannel {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') {
    return {
      transport: 'none',
      send: () => {},
      subscribe: () => () => {},
      onReady: (handler) => {
        handler(false)
        return () => {}
      },
      close: () => {},
    }
  }

  let channel: BroadcastChannel | null = null
  try {
    channel = new window.BroadcastChannel(channelName(roomCode))
  } catch {
    return {
      transport: 'none',
      send: () => {},
      subscribe: () => () => {},
      onReady: (handler) => {
        handler(false)
        return () => {}
      },
      close: () => {},
    }
  }

  return {
    transport: 'local',
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
    onReady: (handler) => {
      handler(true)
      return () => {}
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
