import type { TimerSnapshot } from '../types'

/**
 * 計時器核心（純函式）。
 *
 * 設計原則：
 * 1. 絕不每秒寫入資料庫，只儲存 timerStartedAt + remainingMsAtStart + timerStatus。
 * 2. 各裝置一律用「時間差」重算顯示時間，禁止遞減式 setInterval，
 *    如此手機切到背景被節流、電視重新整理、多裝置同時觀看都不會漂移。
 * 3. 單機模式使用本機時間；連線模式使用伺服器時間（由 clockOffset 校正）。
 */

export function createTimer(durationMs: number): TimerSnapshot {
  return { timerStatus: 'STOPPED', timerStartedAt: null, remainingMsAtStart: durationMs }
}

export function computeRemainingMs(timer: TimerSnapshot, now: number): number {
  if (timer.timerStatus !== 'RUNNING' || timer.timerStartedAt === null) {
    return clampMs(timer.remainingMsAtStart)
  }
  const elapsed = now - timer.timerStartedAt
  return clampMs(timer.remainingMsAtStart - elapsed)
}

export function startTimer(timer: TimerSnapshot, now: number): TimerSnapshot {
  if (timer.timerStatus === 'RUNNING') return timer
  if (clampMs(timer.remainingMsAtStart) === 0) return timer
  return {
    timerStatus: 'RUNNING',
    timerStartedAt: now,
    remainingMsAtStart: clampMs(timer.remainingMsAtStart),
  }
}

export function pauseTimer(timer: TimerSnapshot, now: number): TimerSnapshot {
  if (timer.timerStatus !== 'RUNNING') return timer
  return {
    timerStatus: 'PAUSED',
    timerStartedAt: null,
    remainingMsAtStart: computeRemainingMs(timer, now),
  }
}

export function resetTimer(durationMs: number): TimerSnapshot {
  return createTimer(durationMs)
}

export function setRemaining(
  timer: TimerSnapshot,
  remainingMs: number,
  now: number,
): TimerSnapshot {
  if (timer.timerStatus === 'RUNNING') {
    return { timerStatus: 'RUNNING', timerStartedAt: now, remainingMsAtStart: clampMs(remainingMs) }
  }
  return { ...timer, remainingMsAtStart: clampMs(remainingMs) }
}

export function isExpired(timer: TimerSnapshot, now: number): boolean {
  return computeRemainingMs(timer, now) <= 0
}

function clampMs(ms: number): number {
  return ms > 0 ? ms : 0
}

/**
 * 顯示格式。
 * 剩餘 10 秒以內顯示到小數一位（配合最後 10 秒判罰需要精確判讀）。
 */
export function formatClock(remainingMs: number, showTenths = true): string {
  const ms = clampMs(remainingMs)
  if (showTenths && ms < 10_000) {
    const seconds = Math.floor(ms / 1000)
    const tenths = Math.floor((ms % 1000) / 100)
    return `${seconds}.${tenths}`
  }
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
