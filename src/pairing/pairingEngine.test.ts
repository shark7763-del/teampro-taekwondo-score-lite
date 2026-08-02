import { describe, expect, it } from 'vitest'
import {
  isExpired,
  pressStatus,
  prunePresses,
  submitJudgePress,
  type JudgePress,
  type PairingContext,
  type PressInput,
} from './pairingEngine'

const T0 = 1_700_000_000_000
const WINDOW = 1_000

function ctx(overrides: Partial<PairingContext> = {}): PairingContext {
  return {
    presses: [],
    confirmationWindowMs: WINDOW,
    requiredConfirmations: 2,
    cooldownMs: 180,
    maxPressesPerSecond: 3,
    now: T0,
    matchAcceptsScore: true,
    ...overrides,
  }
}

function press(overrides: Partial<PressInput> = {}): PressInput {
  return {
    clientEventId: `evt-${Math.random().toString(36).slice(2)}`,
    matchId: 'm1',
    deviceId: 'device-a',
    judgeSeat: 'A',
    athleteSide: 'BLUE',
    actionType: 'BODY_KICK',
    ...overrides,
  }
}

const seatB = { deviceId: 'device-b', judgeSeat: 'B' } as const

describe('雙裁判配對引擎', () => {
  it('#11 裁判 A 單獨按下不成立，只會進入等待', () => {
    const result = submitJudgePress(ctx(), press())
    expect(result.outcome.status).toBe('WAITING')
    expect(result.presses).toHaveLength(1)
    expect(result.matchedGroup).toHaveLength(0)
  })

  it('#12 裁判 B 單獨按下同樣不成立', () => {
    const result = submitJudgePress(ctx(), press(seatB))
    expect(result.outcome.status).toBe('WAITING')
  })

  it('#13 A、B 按相同選手與相同技術，在時間窗內成立一次', () => {
    const first = submitJudgePress(ctx(), press())
    const second = submitJudgePress(
      ctx({ presses: first.presses, now: T0 + 400 }),
      press(seatB),
    )
    expect(second.outcome.status).toBe('MATCHED')
    expect(second.matchedGroup).toHaveLength(2)
    // 兩筆共用同一個 matchedGroupId → 分數只會加一次
    const ids = new Set(second.matchedGroup.map((p) => p.matchedGroupId))
    expect(ids.size).toBe(1)
  })

  it('先送後送順序不影響結果（B 先送、A 後送同樣成立）', () => {
    const first = submitJudgePress(ctx(), press(seatB))
    const second = submitJudgePress(ctx({ presses: first.presses, now: T0 + 300 }), press())
    expect(second.outcome.status).toBe('MATCHED')
  })

  it('#14 A、B 按不同選手不成立', () => {
    const first = submitJudgePress(ctx(), press({ athleteSide: 'BLUE' }))
    const second = submitJudgePress(
      ctx({ presses: first.presses, now: T0 + 200 }),
      press({ ...seatB, athleteSide: 'RED' }),
    )
    expect(second.outcome.status).toBe('WAITING')
  })

  it('#15 A、B 按相同選手但不同技術不成立', () => {
    const first = submitJudgePress(ctx(), press({ actionType: 'BODY_KICK' }))
    const second = submitJudgePress(
      ctx({ presses: first.presses, now: T0 + 200 }),
      press({ ...seatB, actionType: 'HEAD_KICK' }),
    )
    expect(second.outcome.status).toBe('WAITING')
  })

  it('#16 超過確認時間窗不成立（以伺服器時間差判斷）', () => {
    const first = submitJudgePress(ctx(), press())
    const second = submitJudgePress(
      ctx({ presses: first.presses, now: T0 + WINDOW + 1 }),
      press(seatB),
    )
    expect(second.outcome.status).toBe('WAITING')
    expect(pressStatus(second.presses, first.presses[0]!.id, { now: T0 + WINDOW + 1, confirmationWindowMs: WINDOW })).toBe(
      'EXPIRED',
    )
  })

  it('剛好等於時間窗仍算在窗內（邊界值）', () => {
    const first = submitJudgePress(ctx(), press())
    const second = submitJudgePress(
      ctx({ presses: first.presses, now: T0 + WINDOW }),
      press(seatB),
    )
    expect(second.outcome.status).toBe('MATCHED')
  })

  it('#17 同一位裁判連按兩次不得自行成立', () => {
    const first = submitJudgePress(ctx(), press())
    const second = submitJudgePress(
      ctx({ presses: first.presses, now: T0 + 500 }),
      press({ clientEventId: 'evt-2' }), // 仍是 A
    )
    expect(second.outcome.status).toBe('WAITING')
    expect(second.presses.every((p) => p.matchedGroupId === null)).toBe(true)
  })

  it('同一位裁判在冷卻時間內連按會被拒絕（防手指抖動）', () => {
    const first = submitJudgePress(ctx(), press())
    const second = submitJudgePress(
      ctx({ presses: first.presses, now: T0 + 100 }),
      press({ clientEventId: 'evt-2' }),
    )
    expect(second.outcome).toEqual({ status: 'REJECTED', reason: 'COOLDOWN' })
  })

  it('#18 相同 clientEventId 重送不重複得分，並回傳第一次的結果', () => {
    const first = submitJudgePress(ctx(), press({ clientEventId: 'same' }))
    const matched = submitJudgePress(
      ctx({ presses: first.presses, now: T0 + 200 }),
      press({ ...seatB, clientEventId: 'other' }),
    )
    expect(matched.outcome.status).toBe('MATCHED')

    // A 因網路問題自動重送同一個 clientEventId
    const resend = submitJudgePress(
      ctx({ presses: matched.presses, now: T0 + 900 }),
      press({ clientEventId: 'same' }),
    )
    expect(resend.outcome).toEqual({ status: 'DUPLICATE', clientEventId: 'same' })
    expect(resend.presses).toHaveLength(matched.presses.length)
    // 仍然只有一組 matchedGroupId
    const groups = new Set(
      resend.presses.map((p) => p.matchedGroupId).filter((id): id is string => id !== null),
    )
    expect(groups.size).toBe(1)
  })

  it('#19 完全同時送出（相同伺服器時間）也只成立一次', () => {
    const first = submitJudgePress(ctx(), press({ clientEventId: 'a1' }))
    const second = submitJudgePress(
      ctx({ presses: first.presses, now: T0 }),
      press({ ...seatB, clientEventId: 'b1' }),
    )
    expect(second.outcome.status).toBe('MATCHED')
    const groups = new Set(
      second.presses.map((p) => p.matchedGroupId).filter((id): id is string => id !== null),
    )
    expect(groups.size).toBe(1)
    expect(second.presses.filter((p) => p.matchedGroupId !== null)).toHaveLength(2)
  })

  it('#20 已配對的事件不可再次被配對', () => {
    const a1 = submitJudgePress(ctx(), press({ clientEventId: 'a1' }))
    const b1 = submitJudgePress(
      ctx({ presses: a1.presses, now: T0 + 100 }),
      press({ ...seatB, clientEventId: 'b1' }),
    )
    expect(b1.outcome.status).toBe('MATCHED')

    // B 再按一次（冷卻已過），不可以跟已配對的 A 事件再配一次
    const b2 = submitJudgePress(
      ctx({ presses: b1.presses, now: T0 + 500 }),
      press({ ...seatB, clientEventId: 'b2' }),
    )
    expect(b2.outcome.status).toBe('WAITING')
    expect(b2.presses.filter((p) => p.matchedGroupId !== null)).toHaveLength(2)
  })

  it('#21 過期事件不可配對新的裁判事件（舊事件不會偷偷成立）', () => {
    const old = submitJudgePress(ctx(), press({ clientEventId: 'old' }))
    // A 的舊事件過期後，B 才按下
    const late = submitJudgePress(
      ctx({ presses: old.presses, now: T0 + 5_000 }),
      press({ ...seatB, clientEventId: 'late' }),
    )
    expect(late.outcome.status).toBe('WAITING')

    // 此時 A 再按一次新的，應該與 B 的新事件配對，而不是用舊事件
    const fresh = submitJudgePress(
      ctx({ presses: late.presses, now: T0 + 5_200 }),
      press({ clientEventId: 'fresh' }),
    )
    expect(fresh.outcome.status).toBe('MATCHED')
    const matchedIds = fresh.matchedGroup.map((p) => p.clientEventId).sort()
    expect(matchedIds).toEqual(['fresh', 'late'])
  })

  it('#22 比賽結束後不可加分', () => {
    const result = submitJudgePress(
      ctx({ matchAcceptsScore: false, matchRejection: 'MATCH_FINISHED' }),
      press(),
    )
    expect(result.outcome).toEqual({ status: 'REJECTED', reason: 'MATCH_FINISHED' })
    expect(result.presses).toHaveLength(0)
  })

  it('#23 暫停時依設定拒絕（由比賽狀態機決定是否接受）', () => {
    const rejectedResult = submitJudgePress(
      ctx({ matchAcceptsScore: false, matchRejection: 'MATCH_PAUSED' }),
      press(),
    )
    expect(rejectedResult.outcome).toEqual({ status: 'REJECTED', reason: 'MATCH_PAUSED' })

    const acceptedResult = submitJudgePress(ctx({ matchAcceptsScore: true }), press())
    expect(acceptedResult.outcome.status).toBe('WAITING')
  })

  it('同一裝置超過每秒次數上限會被拒絕', () => {
    let presses: JudgePress[] = []
    for (let i = 0; i < 3; i += 1) {
      const result = submitJudgePress(
        ctx({ presses, now: T0 + i * 200, cooldownMs: 0 }),
        press({ clientEventId: `e${i}`, actionType: i === 0 ? 'BODY_KICK' : 'HEAD_KICK' }),
      )
      presses = result.presses
    }
    const blocked = submitJudgePress(
      ctx({ presses, now: T0 + 600, cooldownMs: 0 }),
      press({ clientEventId: 'e-extra', actionType: 'BODY_PUNCH' }),
    )
    expect(blocked.outcome).toEqual({ status: 'REJECTED', reason: 'RATE_LIMIT' })
  })

  it('單裁判模式：一位裁判按下即成立', () => {
    const result = submitJudgePress(ctx({ requiredConfirmations: 1 }), press())
    expect(result.outcome.status).toBe('MATCHED')
    expect(result.matchedGroup).toHaveLength(1)
  })

  it('三裁判模式（三取二）：任兩位不同席位確認即成立', () => {
    const c = ctx({ requiredConfirmations: 2 })
    const a = submitJudgePress(c, press({ clientEventId: 'a' }))
    const cSeat = submitJudgePress(
      ctx({ presses: a.presses, now: T0 + 200 }),
      press({ clientEventId: 'c', deviceId: 'device-c', judgeSeat: 'C' }),
    )
    expect(cSeat.outcome.status).toBe('MATCHED')
    expect(cSeat.matchedGroup.map((p) => p.judgeSeat).sort()).toEqual(['A', 'C'])
  })

  it('多筆待配對時採「最早未配對優先」，行為可預測', () => {
    // A 先後按了兩次身體踢擊（間隔超過冷卻）
    const a1 = submitJudgePress(ctx({ cooldownMs: 0 }), press({ clientEventId: 'a1' }))
    const a2 = submitJudgePress(
      ctx({ presses: a1.presses, now: T0 + 300, cooldownMs: 0 }),
      press({ clientEventId: 'a2' }),
    )
    const b = submitJudgePress(
      ctx({ presses: a2.presses, now: T0 + 400 }),
      press({ ...seatB, clientEventId: 'b1' }),
    )
    expect(b.outcome.status).toBe('MATCHED')
    expect(b.matchedGroup.map((p) => p.clientEventId).sort()).toEqual(['a1', 'b1'])
  })

  it('輔助函式：過期判定、狀態查詢與清理', () => {
    const first = submitJudgePress(ctx(), press())
    const p = first.presses[0]!
    expect(isExpired(p, { now: T0 + 500, confirmationWindowMs: WINDOW })).toBe(false)
    expect(isExpired(p, { now: T0 + 1_001, confirmationWindowMs: WINDOW })).toBe(true)
    expect(pressStatus(first.presses, p.id, { now: T0, confirmationWindowMs: WINDOW })).toBe(
      'WAITING',
    )
    expect(pressStatus(first.presses, 'nope', { now: T0, confirmationWindowMs: WINDOW })).toBe(
      'UNKNOWN',
    )
    expect(prunePresses(first.presses, { now: T0 + 60_000, keepMs: 30_000 })).toHaveLength(0)
  })
})
