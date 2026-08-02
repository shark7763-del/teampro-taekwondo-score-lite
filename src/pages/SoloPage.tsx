import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Scoreboard } from '../components/Scoreboard'
import { ScoreButtons } from '../components/ScoreButtons'
import { ActionButton, Toast } from '../components/ui'
import { useNow } from '../hooks/useNow'
import { useFullscreen, useWakeLock } from '../hooks/useFullscreen'
import { useSoloMatch } from '../hooks/useSoloMatch'
import {
  describeEvent,
  pointsForAction,
  reversedEventIds,
  roundReasonLabel,
  sideLabel,
} from '../rules/ruleEngine'
import { getRuleSet } from '../rules/ruleSets'
import type { ActionType, AthleteSide, GamjeomReason } from '../types'
import { canAcceptScore, type CommandRejection } from '../match/matchCore'

const REJECTION_TEXT: Record<string, string> = {
  MATCH_FINISHED: '比賽已結束，無法計分',
  MATCH_PAUSED: '暫停中不接受計分（可於設定開放）',
  MATCH_NOT_RUNNING: '請先按「開始」',
  NOT_LAST_10_SECONDS: '僅限回合最後 10 秒且比賽進行中才能使用',
  NOTHING_TO_REVERSE: '沒有可復原的紀錄',
  INVALID_COMMAND: '此操作目前不可執行',
  ALREADY_REVERSED: '這筆紀錄已經復原過了',
}

const IDLE_MS = 3_000

export function SoloPage(): React.ReactElement {
  const now = useNow(100)
  const { state, remainingMs, lastFlash, lastRejection, dispatch, resetAll } = useSoloMatch(now)
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()
  const [mirrorMode, setMirrorMode] = useState(false)
  const [correctionMode, setCorrectionMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [lastInteraction, setLastInteraction] = useState(() => Date.now())

  useWakeLock(true)

  const rules = getRuleSet(state.config.ruleSetCode)
  const canSpecialGamjeom =
    state.matchStatus === 'RUNNING' &&
    remainingMs > 0 &&
    remainingMs <= rules.gamjeom.lastSecondsWindowMs
  const running = state.timer.timerStatus === 'RUNNING'
  const idle = !mirrorMode && now - lastInteraction > IDLE_MS && running

  const touch = useCallback(() => setLastInteraction(Date.now()), [])

  useEffect(() => {
    const handler = (): void => setLastInteraction(Date.now())
    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [])

  const onScore = useCallback(
    (side: AthleteSide, action: ActionType): boolean => {
      touch()
      if (correctionMode) {
        dispatch({
          type: 'MANUAL_ADJUST',
          side,
          deltaPoints: -pointsForAction(action, state.config.ruleSetCode),
          note: '教練現場修正',
        })
        return state.matchStatus !== 'FINISHED'
      }
      dispatch({ type: 'SCORE', side, action })
      return canAcceptScore(state).ok
    },
    [correctionMode, dispatch, state, touch],
  )

  const onGamjeom = useCallback(
    (side: AthleteSide, special: boolean, reason: GamjeomReason = 'OTHER') => {
      touch()
      dispatch({ type: 'GAMJEOM', side, reason: special ? reason : 'OTHER', special })
    },
    [dispatch, touch],
  )

  const rejectionMessage = useMemo(() => {
    if (lastRejection === null) return null
    if (now - lastRejection.at > 2_500) return null
    return REJECTION_TEXT[lastRejection.reason as CommandRejection] ?? '操作被拒絕'
  }, [lastRejection, now])

  return (
    <div className="safe-area flex h-dvh w-full flex-col overflow-hidden bg-ink">
      {rejectionMessage !== null && <Toast message={rejectionMessage} />}

      {!mirrorMode && (
        <header className="flex items-center gap-2 border-b border-line bg-panel px-2 py-1">
          <Link
            to="/"
            className="rounded px-2 py-1 text-sm font-bold text-slate-300 hover:bg-white/5"
          >
            ← 首頁
          </Link>
          <span className="text-sm font-bold text-slate-400">單手機計分</span>
          <div className="ml-auto flex gap-1">
            <ActionButton
              tone="ghost"
              className="min-h-[40px] px-2 text-xs"
              onClick={() => setShowLog((v) => !v)}
            >
              紀錄
            </ActionButton>
            <ActionButton
              tone="ghost"
              className="min-h-[40px] px-2 text-xs"
              onClick={() => setShowSettings(true)}
            >
              設定
            </ActionButton>
            <ActionButton
              tone="ghost"
              className="min-h-[40px] px-2 text-xs"
              onClick={() => {
                setMirrorMode(true)
                if (!isFullscreen) toggleFullscreen()
              }}
            >
              鏡射模式
            </ActionButton>
            <ActionButton
              tone="ghost"
              className="min-h-[40px] px-2 text-xs"
              onClick={toggleFullscreen}
            >
              {isFullscreen ? '離開全螢幕' : '全螢幕'}
            </ActionButton>
          </div>
        </header>
      )}

      <main className={mirrorMode ? 'flex-1' : 'flex-[1.15]'}>
        <Scoreboard
          state={state}
          remainingMs={remainingMs}
          flash={lastFlash}
          compact={!mirrorMode}
        />
      </main>

      {mirrorMode ? (
        <button
          type="button"
          onClick={() => setMirrorMode(false)}
          className="min-h-[56px] w-full border-t border-line bg-panel text-sm font-bold text-slate-400"
        >
          點此顯示操作面板
        </button>
      ) : (
        <section
          onPointerDown={touch}
          className={`grid grid-cols-[1fr_minmax(30%,34%)_1fr] gap-1 border-t-2 border-line bg-panel p-1 transition-opacity duration-500 ${
            idle ? 'opacity-30' : 'opacity-100'
          }`}
        >
          <div className="flex flex-col gap-1">
            <ScoreButtons
              side="BLUE"
              ruleSetCode={state.config.ruleSetCode}
              disabled={state.matchStatus === 'FINISHED'}
              correctionMode={correctionMode}
              onPress={onScore}
            />
            <ActionButton
              tone="warning"
              className="min-h-[44px] text-xs"
              onClick={() => onGamjeom('BLUE', false)}
            >
              藍方違規，紅方 +1
            </ActionButton>
            {canSpecialGamjeom && (
              <ActionButton
                tone="danger"
                className="min-h-[44px] text-xs"
                onClick={() => onGamjeom('BLUE', true, 'AVOIDING')}
              >
                藍方最後10秒消極，紅方 +2
              </ActionButton>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-2 gap-1">
              <ActionButton
                tone={running ? 'warning' : 'primary'}
                onClick={() => dispatch({ type: running ? 'PAUSE' : 'START' })}
                disabled={state.matchStatus === 'FINISHED'}
              >
                {running ? '暫停' : state.matchStatus === 'READY' ? '開始' : '繼續'}
              </ActionButton>
              <ActionButton tone="neutral" onClick={() => dispatch({ type: 'UNDO' })}>
                復原
              </ActionButton>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <ActionButton
                tone="neutral"
                className="min-h-[44px] text-xs"
                onClick={() => dispatch({ type: 'NEXT_ROUND' })}
              >
                {state.matchStatus === 'REST' ? '開始下一回合' : '結束本回合'}
              </ActionButton>
              <ActionButton
                tone={correctionMode ? 'warning' : 'neutral'}
                className="min-h-[44px] text-xs"
                onClick={() => setCorrectionMode((v) => !v)}
              >
                {correctionMode ? '修正中' : '扣分修正'}
              </ActionButton>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <ScoreButtons
              side="RED"
              ruleSetCode={state.config.ruleSetCode}
              disabled={state.matchStatus === 'FINISHED'}
              correctionMode={correctionMode}
              onPress={onScore}
            />
            <ActionButton
              tone="warning"
              className="min-h-[44px] text-xs"
              onClick={() => onGamjeom('RED', false)}
            >
              紅方違規，藍方 +1
            </ActionButton>
            {canSpecialGamjeom && (
              <ActionButton
                tone="danger"
                className="min-h-[44px] text-xs"
                onClick={() => onGamjeom('RED', true, 'AVOIDING')}
              >
                紅方最後10秒消極，藍方 +2
              </ActionButton>
            )}
          </div>
        </section>
      )}

      {state.pendingSuperiorityRound !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border-2 border-amber-500/60 bg-panel p-5 text-center">
            <h2 className="text-xl font-black text-amber-300">
              第 {state.pendingSuperiorityRound} 回合平手
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              分數、旋轉技術得分與各分值技術數量皆相同，請依優勢判定本回合勝方。
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-panel-2 p-2 text-xs">
              <dt className="text-left text-slate-500">參考</dt>
              <dd className="font-bold text-blue-300">{state.config.blueName}</dd>
              <dd className="font-bold text-red-300">{state.config.redName}</dd>
              <dt className="text-left text-slate-400">本回合分數</dt>
              <dd className="tabular">{state.scores.blueScore}</dd>
              <dd className="tabular">{state.scores.redScore}</dd>
              <dt className="text-left text-slate-400">Gam-jeom</dt>
              <dd className="tabular">{state.scores.blueGamjeom}</dd>
              <dd className="tabular">{state.scores.redGamjeom}</dd>
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ActionButton
                tone="neutral"
                className="min-h-[64px] border-blue-300/60 bg-blue-side text-white"
                onClick={() => dispatch({ type: 'DECIDE_SUPERIORITY', winner: 'BLUE' })}
              >
                {state.config.blueName} 勝
              </ActionButton>
              <ActionButton
                tone="neutral"
                className="min-h-[64px] border-red-300/60 bg-red-side text-white"
                onClick={() => dispatch({ type: 'DECIDE_SUPERIORITY', winner: 'RED' })}
              >
                {state.config.redName} 勝
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {showLog && !mirrorMode && (
        <EventLogDrawer
          state={state}
          onClose={() => setShowLog(false)}
          onReverse={(id) => dispatch({ type: 'REVERSE_EVENT', eventId: id })}
        />
      )}

      {showSettings && (
        <SettingsDrawer
          state={state}
          onClose={() => setShowSettings(false)}
          onRename={(side, name) => dispatch({ type: 'RENAME', side, name })}
          onSwap={() => dispatch({ type: 'SWAP_SIDES' })}
          onFinish={() => dispatch({ type: 'FINISH' })}
          onRestart={() => dispatch({ type: 'RESTART' })}
          onResetAll={resetAll}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function EventLogDrawer({
  state,
  onClose,
  onReverse,
}: {
  state: ReturnType<typeof useSoloMatch>['state']
  onClose: () => void
  onReverse: (id: string) => void
}): React.ReactElement {
  const reversed = reversedEventIds(state.events)
  const items = [...state.events].reverse()

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-panel p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">得分紀錄（{state.events.length}）</h2>
          <ActionButton tone="ghost" className="min-h-[40px]" onClick={onClose}>
            關閉
          </ActionButton>
        </div>
        {state.roundResults.length > 0 && (
          <div className="mb-3 rounded-lg border border-line bg-panel-2 p-2">
            <h3 className="mb-1 text-sm font-bold text-slate-300">回合戰績</h3>
            <ul className="flex flex-col gap-1 text-xs text-slate-300">
              {state.roundResults.map((r) => (
                <li key={r.round} className="flex justify-between gap-2">
                  <span>
                    第 {r.round} 回合 {r.blueScore} : {r.redScore}
                  </span>
                  <span className="font-bold">
                    {r.winner === 'BLUE' ? state.config.blueName : state.config.redName} 勝
                    <span className="ml-1 font-normal text-slate-500">
                      （{r.reason === null ? '' : roundReasonLabel(r.reason)}）
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {items.length === 0 && <p className="text-sm text-slate-400">尚無紀錄</p>}
        <ul className="flex flex-col gap-2">
          {items.map((event) => (
            <li
              key={event.id}
              className={`rounded-lg border border-line p-2 text-sm ${
                event.type === 'REVERSAL' ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{describeEvent(event)}</span>
                {event.type !== 'REVERSAL' && !reversed.has(event.id) && (
                  <button
                    type="button"
                    onClick={() => onReverse(event.id)}
                    className="rounded bg-slate-700 px-2 py-1 text-xs font-bold"
                  >
                    復原
                  </button>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                第 {event.round} 回合 · 剩 {(event.remainingMsAtEvent / 1000).toFixed(1)} 秒
                {reversed.has(event.id) ? ' · 已復原' : ''}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SettingsDrawer({
  state,
  onClose,
  onRename,
  onSwap,
  onFinish,
  onRestart,
  onResetAll,
}: {
  state: ReturnType<typeof useSoloMatch>['state']
  onClose: () => void
  onRename: (side: AthleteSide, name: string) => void
  onSwap: () => void
  onFinish: () => void
  onRestart: () => void
  onResetAll: () => void
}): React.ReactElement {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">比賽設定</h2>
          <ActionButton tone="ghost" className="min-h-[40px]" onClick={onClose}>
            關閉
          </ActionButton>
        </div>

        <div className="flex flex-col gap-3">
          {(['BLUE', 'RED'] as const).map((side) => (
            <label key={side} className="flex items-center gap-2">
              <span className="w-16 text-sm font-bold">{sideLabel(side)}姓名</span>
              <input
                className="flex-1 rounded border border-line bg-panel-2 px-3 py-2 text-base"
                defaultValue={side === 'BLUE' ? state.config.blueName : state.config.redName}
                maxLength={12}
                onChange={(e) => onRename(side, e.target.value)}
              />
            </label>
          ))}

          <ActionButton tone="neutral" onClick={onSwap}>
            交換藍紅姓名（版位不變）
          </ActionButton>

          <div className="rounded-lg border border-line p-3 text-sm text-slate-300">
            <p>
              回合：{state.config.totalRounds} 回合 ×{' '}
              {Math.round(state.config.roundDurationMs / 1000)} 秒，休息{' '}
              {Math.round(state.config.restDurationMs / 1000)} 秒
            </p>
            <p className="mt-1 text-xs text-slate-500">
              回合時間調整將於第二階段的「建立比賽」頁面提供。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <ActionButton tone="danger" onClick={onFinish}>
              結束比賽
            </ActionButton>
            <ActionButton tone="neutral" onClick={onRestart}>
              重新開賽
            </ActionButton>
          </div>

          <ActionButton
            tone="ghost"
            onClick={() => {
              if (window.confirm('確定要清除本機這場比賽的所有紀錄嗎？')) {
                onResetAll()
                onClose()
              }
            }}
          >
            清除本機紀錄
          </ActionButton>

          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            ⚠️ 本系統供訓練賽及模擬賽使用，非 WT 認證競賽設備。規則版本{' '}
            {getRuleSet(state.config.ruleSetCode).effectiveDate}。
          </p>
        </div>
      </div>
    </div>
  )
}
