import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommandRejection, MatchCommand } from '../match/matchCore'
import { createMatchState, reduceMatch } from '../match/matchCore'
import type { MatchEvent, MatchState } from '../types'
import { computeRemainingMs } from '../timer/timer'
import { clearSoloMatch, loadSoloMatch, saveSoloMatch } from '../storage/soloStorage'
import { beep, unlockAudio, vibrate } from '../lib/feedback'

export interface FlashEvent {
  key: string
  event: MatchEvent
}

export interface SoloMatchApi {
  state: MatchState
  remainingMs: number
  lastFlash: FlashEvent | null
  lastRejection: { reason: CommandRejection; at: number } | null
  dispatch: (command: MatchCommand) => void
  resetAll: () => void
  restoredFromStorage: boolean
}

/**
 * 單機模式狀態管理。
 * 完全離線運作：狀態存在記憶體＋localStorage，不依賴任何網路。
 */
export function useSoloMatch(now: number): SoloMatchApi {
  const [state, setState] = useState<MatchState>(() => {
    const restored = loadSoloMatch()
    return restored?.state ?? createMatchState()
  })
  const [restoredFromStorage] = useState<boolean>(() => loadSoloMatch() !== null)
  const [lastFlash, setLastFlash] = useState<FlashEvent | null>(null)
  const [lastRejection, setLastRejection] = useState<{
    reason: CommandRejection
    at: number
  } | null>(null)
  const timeUpHandledRef = useRef<string>('')

  const dispatch = useCallback((command: MatchCommand) => {
    unlockAudio()
    setState((current) => {
      const result = reduceMatch(current, command, Date.now())
      if (result.rejected !== undefined) {
        vibrate('rejected', current.config.vibrationEnabled)
        setLastRejection({ reason: result.rejected, at: Date.now() })
        return current
      }
      if (result.emitted !== undefined) {
        const emitted = result.emitted
        setLastFlash({ key: emitted.id, event: emitted })
        vibrate(emitted.type === 'SCORE' ? 'press' : 'confirmed', current.config.vibrationEnabled)
        beep('score', current.config.soundEnabled)
      }
      saveSoloMatch(result.state)
      return result.state
    })
  }, [])

  const resetAll = useCallback(() => {
    clearSoloMatch()
    setState(createMatchState())
    setLastFlash(null)
    setLastRejection(null)
  }, [])

  const remainingMs = computeRemainingMs(state.timer, now)

  // 時間到：只由本裝置（單機模式下唯一的控制端）觸發一次
  useEffect(() => {
    if (state.timer.timerStatus !== 'RUNNING') return
    if (remainingMs > 0) return
    const key = `${state.config.matchId}-${state.currentRound}-${state.matchStatus}`
    if (timeUpHandledRef.current === key) return
    timeUpHandledRef.current = key

    setState((current) => {
      const result = reduceMatch(current, { type: 'TIME_UP' }, Date.now())
      beep(
        result.state.matchStatus === 'FINISHED' ? 'matchEnd' : 'roundEnd',
        current.config.soundEnabled,
      )
      vibrate('roundEnd', current.config.vibrationEnabled)
      saveSoloMatch(result.state)
      return result.state
    })
  }, [
    remainingMs,
    state.timer.timerStatus,
    state.config.matchId,
    state.currentRound,
    state.matchStatus,
  ])

  return { state, remainingMs, lastFlash, lastRejection, dispatch, resetAll, restoredFromStorage }
}
