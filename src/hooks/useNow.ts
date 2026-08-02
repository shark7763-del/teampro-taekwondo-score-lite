import { useEffect, useState } from 'react'

/**
 * 提供目前時間戳的 tick。
 *
 * 計時顯示一律以「時間差」重算（見 src/timer/timer.ts），
 * 本 hook 只負責觸發重繪，不負責累計時間，
 * 因此手機切到背景被節流也不會造成時間漂移。
 */
export function useNow(intervalMs = 100, active = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    const onVisible = (): void => setNow(Date.now())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs, active])

  return now
}
