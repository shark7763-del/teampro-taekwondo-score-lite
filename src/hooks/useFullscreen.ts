import { useCallback, useEffect, useState } from 'react'

/** 全螢幕切換（電視端與鏡射模式使用），並在支援時保持螢幕恆亮 */
export function useFullscreen(): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = useCallback(() => {
    void (async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen()
        } else {
          await document.exitFullscreen()
        }
      } catch (error) {
        console.warn('[fullscreen] 無法切換全螢幕', error)
      }
    })()
  }, [])

  return { isFullscreen, toggle }
}

interface WakeLockSentinelLike {
  release: () => Promise<void>
}

/** 計分中避免螢幕自動關閉（不支援的裝置自動略過） */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const request = async (): Promise<void> => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
        }
        if (nav.wakeLock === undefined) return
        const lock = await nav.wakeLock.request('screen')
        if (cancelled) {
          void lock.release()
          return
        }
        sentinel = lock
      } catch {
        /* 使用者拒絕或不支援，忽略 */
      }
    }

    void request()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel !== null) void sentinel.release()
    }
  }, [active])
}
