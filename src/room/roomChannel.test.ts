import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoomChannel, type RoomChannel } from './roomChannel'
import type { RoomMessage } from './roomTypes'

/**
 * 這裡驗證的是「未設定 Supabase 時的本機退路」。
 * 雲端傳輸的行為由 Supabase Realtime 保證，無法在 jsdom 內有意義地模擬，
 * 但兩種實作共用同一組介面契約：送出的訊息會送達其他訂閱者，且不會回送給自己。
 */

const opened: RoomChannel[] = []

function open(roomCode: string): RoomChannel {
  const channel = createRoomChannel(roomCode)
  opened.push(channel)
  return channel
}

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close()
})

describe('房間訊息通道（本機退路）', () => {
  it('未設定 Supabase 時使用 BroadcastChannel', () => {
    expect(open('ABCDEF').transport).toBe('local')
  })

  it('訊息會送達同房間的其他訂閱者', async () => {
    const host = open('ABCDEF')
    const client = open('ABCDEF')
    const received: RoomMessage[] = []
    client.subscribe((message) => received.push(message))

    host.send({ type: 'HELLO', deviceId: 'dev-1', role: 'DISPLAY', judgeSeat: null })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]?.type).toBe('HELLO')
  })

  it('不會收到自己送出的訊息', async () => {
    const host = open('ABCDEF')
    const other = open('ABCDEF')
    const mine: RoomMessage[] = []
    const theirs: RoomMessage[] = []
    host.subscribe((message) => mine.push(message))
    other.subscribe((message) => theirs.push(message))

    host.send({ type: 'PING', deviceId: 'dev-1', role: 'JUDGE', judgeSeat: 'A' })
    await vi.waitFor(() => expect(theirs).toHaveLength(1))
    expect(mine).toHaveLength(0)
  })

  it('不同房間代碼互不干擾', async () => {
    const roomA = open('AAAAAA')
    const roomB = open('BBBBBB')
    const listenerA = open('AAAAAA')
    const receivedA: RoomMessage[] = []
    const receivedB: RoomMessage[] = []
    listenerA.subscribe((message) => receivedA.push(message))
    roomB.subscribe((message) => receivedB.push(message))

    roomA.send({ type: 'PING', deviceId: 'dev-1', role: 'DISPLAY', judgeSeat: null })
    await vi.waitFor(() => expect(receivedA).toHaveLength(1))
    expect(receivedB).toHaveLength(0)
  })

  it('房間代碼大小寫視為同一個房間', async () => {
    const upper = open('ABCDEF')
    const lower = open('abcdef')
    const received: RoomMessage[] = []
    lower.subscribe((message) => received.push(message))

    upper.send({ type: 'PING', deviceId: 'dev-1', role: 'DISPLAY', judgeSeat: null })
    await vi.waitFor(() => expect(received).toHaveLength(1))
  })

  it('關閉後不再收到訊息', async () => {
    const host = open('ABCDEF')
    const client = open('ABCDEF')
    const received: RoomMessage[] = []
    client.subscribe((message) => received.push(message))
    client.close()

    host.send({ type: 'PING', deviceId: 'dev-1', role: 'DISPLAY', judgeSeat: null })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(received).toHaveLength(0)
  })
})
