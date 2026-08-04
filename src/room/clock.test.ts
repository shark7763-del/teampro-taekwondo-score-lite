import { describe, expect, it } from 'vitest'
import { offsetSample, smoothClockOffset } from './clock'

describe('跨裝置時鐘校正', () => {
  it('第一個樣本直接採用', () => {
    expect(smoothClockOffset(null, 3_000)).toBe(3_000)
  })

  it('offset = 主控端送出時間 − 本機收到時間', () => {
    // 主控端時鐘比本機快 5 秒
    expect(offsetSample(105_000, 100_000)).toBe(5_000)
  })

  it('小幅網路抖動只造成小幅修正，不會讓秒數跳動', () => {
    const next = smoothClockOffset(1_000, 1_200)
    expect(next).toBeGreaterThan(1_000)
    expect(next).toBeLessThan(1_100)
  })

  it('裝置休眠後的大幅落差直接採用新值', () => {
    expect(smoothClockOffset(1_000, 60_000)).toBe(60_000)
  })

  it('反覆套用會收斂到真實差距', () => {
    let offset: number | null = null
    for (let i = 0; i < 40; i += 1) offset = smoothClockOffset(offset, 800)
    expect(offset).toBeCloseTo(800, 5)
  })
})
