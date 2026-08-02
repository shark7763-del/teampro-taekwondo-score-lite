import { describe, expect, it } from 'vitest'
import {
  computeRemainingMs,
  createTimer,
  formatClock,
  isExpired,
  pauseTimer,
  resetTimer,
  setRemaining,
  startTimer,
} from './timer'

const T0 = 1_700_000_000_000
const ROUND = 120_000

describe('計時器', () => {
  it('#24 開始、暫停、繼續的剩餘時間正確', () => {
    let timer = createTimer(ROUND)
    expect(computeRemainingMs(timer, T0)).toBe(ROUND)

    timer = startTimer(timer, T0)
    expect(computeRemainingMs(timer, T0 + 5_000)).toBe(115_000)

    timer = pauseTimer(timer, T0 + 5_000)
    expect(timer.timerStatus).toBe('PAUSED')
    // 暫停後時間不再流動
    expect(computeRemainingMs(timer, T0 + 60_000)).toBe(115_000)

    timer = startTimer(timer, T0 + 60_000)
    expect(computeRemainingMs(timer, T0 + 63_000)).toBe(112_000)
  })

  it('#25 重新整理（重新以相同快照計算）後剩餘時間仍正確', () => {
    const timer = startTimer(createTimer(ROUND), T0)
    // 模擬另一個分頁／重新整理後，用同一份快照重算
    const restored = { ...timer }
    expect(computeRemainingMs(restored, T0 + 30_000)).toBe(90_000)
  })

  it('#26 多裝置以同一份快照計算，誤差僅來自時鐘偏移', () => {
    const timer = startTimer(createTimer(ROUND), T0)
    const deviceA = computeRemainingMs(timer, T0 + 10_000)
    const deviceB = computeRemainingMs(timer, T0 + 10_120) // 慢 120ms
    expect(Math.abs(deviceA - deviceB)).toBeLessThanOrEqual(200)
  })

  it('#16 切到背景 30 秒回來，時間以時間差重算而非遞減累積', () => {
    const timer = startTimer(createTimer(ROUND), T0)
    // 期間完全沒有任何 tick
    expect(computeRemainingMs(timer, T0 + 30_000)).toBe(90_000)
  })

  it('時間不會變成負數，並可判定是否結束', () => {
    const timer = startTimer(createTimer(5_000), T0)
    expect(computeRemainingMs(timer, T0 + 9_999)).toBe(0)
    expect(isExpired(timer, T0 + 5_000)).toBe(true)
    expect(isExpired(timer, T0 + 4_999)).toBe(false)
  })

  it('剩餘 0 時不可再啟動；重設回合可恢復', () => {
    let timer = setRemaining(createTimer(ROUND), 0, T0)
    timer = startTimer(timer, T0)
    expect(timer.timerStatus).toBe('STOPPED')

    timer = resetTimer(ROUND)
    expect(startTimer(timer, T0).timerStatus).toBe('RUNNING')
  })

  it('執行中調整剩餘時間會以新的起算點重新計算', () => {
    let timer = startTimer(createTimer(ROUND), T0)
    timer = setRemaining(timer, 20_000, T0 + 5_000)
    expect(computeRemainingMs(timer, T0 + 7_000)).toBe(18_000)
  })

  it('時間顯示格式：10 秒以上為 M:SS，10 秒以內顯示到 0.1 秒', () => {
    expect(formatClock(120_000)).toBe('2:00')
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(10_000)).toBe('0:10')
    expect(formatClock(9_400)).toBe('9.4')
    expect(formatClock(0)).toBe('0.0')
  })
})
