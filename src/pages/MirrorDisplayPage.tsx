import { useEffect, useState } from 'react'
import { Scoreboard } from '../components/Scoreboard'
import { useNow } from '../hooks/useNow'
import { useFullscreen } from '../hooks/useFullscreen'
import { computeRemainingMs } from '../timer/timer'
import { createBroadcastTransport } from '../sync/displaySync'
import { loadSoloMatch } from '../storage/soloStorage'
import type { MatchState } from '../types'

/**
 * 純顯示端（同一台電腦的第二個視窗／第二個螢幕）。
 *
 * 使用 BroadcastChannel 接收控制端推送的畫面快照，不需要任何後端。
 * 只顯示比分、時間、回合與姓名，完全沒有操作按鈕。
 *
 * ⚠️ 跨裝置（手機控制 + 電視顯示）需要房間碼與後端，尚未實作，
 *    因此本頁只在「同一個瀏覽器」有效，不會假裝可以跨裝置同步。
 */
export function MirrorDisplayPage(): React.ReactElement {
  const now = useNow(100)
  const { isFullscreen, toggle } = useFullscreen()
  const [state, setState] = useState<MatchState | null>(() => loadSoloMatch()?.state ?? null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)

  useEffect(() => {
    const transport = createBroadcastTransport()
    const unsubscribe = transport.subscribe((snapshot) => {
      setState(snapshot.state)
      setLastSyncAt(snapshot.sentAt)
    })
    return () => {
      unsubscribe()
      transport.close()
    }
  }, [])

  if (state === null) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-black">顯示端</h1>
        <p className="max-w-md text-sm text-slate-400">
          尚未收到計分資料。請在<b>同一個瀏覽器的另一個視窗</b>開啟「單手機計分」開始比賽，
          本畫面就會自動同步。
        </p>
        <p className="text-xs text-slate-600">
          跨裝置（手機控制＋電視顯示）需要房間碼與後端，尚未實作。
        </p>
      </div>
    )
  }

  const stale = lastSyncAt !== null && now - lastSyncAt > 15_000

  return (
    <div className="relative h-dvh w-full">
      <Scoreboard
        state={state}
        remainingMs={computeRemainingMs(state.timer, now)}
        flash={null}
        statusSlot={
          stale ? (
            <span className="rounded bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">
              控制端已中斷，顯示最後比分
            </span>
          ) : null
        }
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute top-2 right-2 rounded-lg bg-black/40 px-3 py-2 text-xs font-bold text-white/70 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        {isFullscreen ? '離開全螢幕' : '全螢幕'}
      </button>
    </div>
  )
}
