import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Scoreboard } from '../components/Scoreboard'
import { ControlPanel } from '../components/ControlPanel'
import { RoundEndPanel } from '../components/RoundEndPanel'
import { SetupPanel } from '../components/SetupPanel'
import { ConfirmModal } from '../components/ConfirmModal'
import { ActionButton } from '../components/ui'
import { useNow } from '../hooks/useNow'
import { useFullscreen, useWakeLock } from '../hooks/useFullscreen'
import { useSoloMatch } from '../hooks/useSoloMatch'
import { canAcceptScore, type CommandRejection } from '../match/matchCore'
import {
  describeEvent,
  findLastReversibleEvent,
  pointsForAction,
  reversedEventIds,
  roundReasonLabel,
  shortDescribeEvent,
  sideLabel,
} from '../rules/ruleEngine'
import { getRuleSet } from '../rules/ruleSets'
import { computeRemainingMs } from '../timer/timer'
import { beep, vibrate } from '../lib/feedback'
import { loadPreferences, savePreferences, type MatchSetup } from '../storage/preferences'
import { createBroadcastTransport } from '../sync/displaySync'
import type { ActionType, AthleteSide, MatchState } from '../types'

const REJECTION_TEXT: Record<string, string> = {
  MATCH_FINISHED: '比賽已結束，無法計分',
  MATCH_PAUSED: '暫停中不接受計分',
  MATCH_NOT_RUNNING: '請先按「開始」',
  NOT_LAST_10_SECONDS: '僅限回合最後 10 秒且比賽進行中才能使用',
  NOTHING_TO_REVERSE: '沒有可復原的紀錄',
  INVALID_COMMAND: '此操作目前不可執行',
  ALREADY_REVERSED: '這筆紀錄已經復原過了',
}

/** 操作面板閒置多久後淡出（只是視覺變暗，按鍵仍然完全有效） */
const IDLE_MS = 3_000
/** 修正模式無操作自動退出時間 */
const CORRECTION_TIMEOUT_MS = 5_000
/** 記錄提示的顯示時間 */
const TOAST_MS = 2_600

type DangerAction = 'RESTART' | 'CLEAR' | 'DISCARD_RESTORED' | 'FINISH'

export function SoloPage(): React.ReactElement {
  const now = useNow(100)
  const [searchParams, setSearchParams] = useSearchParams()
  const { state, remainingMs, lastFlash, lastRejection, dispatch, resetAll, startNewMatch } =
    useSoloMatch(now)
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()

  const [prefs, setPrefs] = useState(() => loadPreferences())
  const [showSetup, setShowSetup] = useState(() => searchParams.get('setup') === '1')
  const [mirrorMode, setMirrorMode] = useState(false)
  const [correctionMode, setCorrectionMode] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [danger, setDanger] = useState<DangerAction | null>(null)
  const [lastInteraction, setLastInteraction] = useState(() => Date.now())
  const [restoreDismissed, setRestoreDismissed] = useState(false)
  const [correctionStartedAt, setCorrectionStartedAt] = useState(0)
  const lastSecondsNotifiedRef = useRef<string>('')

  useWakeLock(true)

  const rules = getRuleSet(state.config.ruleSetCode)
  const running = state.timer.timerStatus === 'RUNNING'
  const inLastSeconds =
    state.matchStatus === 'RUNNING' &&
    remainingMs > 0 &&
    remainingMs <= rules.gamjeom.lastSecondsWindowMs
  const idle = !mirrorMode && running && now - lastInteraction > IDLE_MS
  const undoTarget = useMemo(() => findLastReversibleEvent(state.events), [state.events])
  const hasProgress = state.events.length > 0 || state.matchStatus !== 'READY'
  // 恢復提示採用上方浮層，不佔用版面高度，也不會蓋住任何計分按鈕
  const showRestoreBanner = !showSetup && !restoreDismissed && hasProgress

  const touch = useCallback(() => setLastInteraction(Date.now()), [])

  /* 任何指標操作都視為互動，用於面板淡出與修正模式逾時 */
  useEffect(() => {
    const handler = (): void => setLastInteraction(Date.now())
    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [])

  /*
   * 修正模式的自動退出（以 render 階段調整 state，不使用 effect，避免串聯重繪）：
   * 1. 5 秒沒有任何操作 → 退出
   * 2. 回合切換、比賽狀態改變或換一場比賽 → 一律不得殘留
   */
  const matchContextKey = `${state.config.matchId}|${state.currentRound}|${state.matchStatus}`
  const [correctionContext, setCorrectionContext] = useState(matchContextKey)
  if (correctionContext !== matchContextKey) {
    setCorrectionContext(matchContextKey)
    if (correctionMode) setCorrectionMode(false)
  }
  if (
    correctionMode &&
    now - Math.max(correctionStartedAt, lastInteraction) > CORRECTION_TIMEOUT_MS
  ) {
    setCorrectionMode(false)
  }

  /* 進入最後 10 秒：短提示音與短震動（不支援時自動略過，不報錯） */
  useEffect(() => {
    if (!inLastSeconds) return
    const key = `${state.config.matchId}-${state.currentRound}`
    if (lastSecondsNotifiedRef.current === key) return
    lastSecondsNotifiedRef.current = key
    beep('warning', state.config.soundEnabled)
    vibrate('press', state.config.vibrationEnabled)
  }, [
    inLastSeconds,
    state.config.matchId,
    state.currentRound,
    state.config.soundEnabled,
    state.config.vibrationEnabled,
  ])

  /* 顯示端同步：同瀏覽器多視窗（筆電接投影機）可開 /#/mirror 當純顯示畫面 */
  useEffect(() => {
    const transport = createBroadcastTransport()
    transport.publish({ sentAt: Date.now(), state })
    return () => transport.close()
  }, [state])

  const persistPrefs = useCallback((next: ReturnType<typeof loadPreferences>) => {
    setPrefs(next)
    savePreferences(next)
  }, [])

  /* ---------------- 操作 ---------------- */

  const handleScore = useCallback(
    (side: AthleteSide, action: ActionType): boolean => {
      touch()
      if (correctionMode) {
        dispatch({
          type: 'MANUAL_ADJUST',
          side,
          deltaPoints: -pointsForAction(action, state.config.ruleSetCode),
          note: '教練現場修正',
        })
        // 單次修正：扣一次就自動退出，避免教練忘記自己還在扣分模式
        setCorrectionMode(false)
        return state.matchStatus !== 'FINISHED'
      }
      dispatch({ type: 'SCORE', side, action })
      return canAcceptScore(state).ok
    },
    [correctionMode, dispatch, state, touch],
  )

  const handleGamjeom = useCallback(
    (side: AthleteSide) => {
      touch()
      dispatch({ type: 'GAMJEOM', side, reason: 'OTHER', special: false })
    },
    [dispatch, touch],
  )

  const handleSpecialGamjeom = useCallback(
    (side: AthleteSide) => {
      touch()
      dispatch({ type: 'GAMJEOM', side, reason: 'AVOIDING', special: true })
    },
    [dispatch, touch],
  )

  const handleStartSetup = useCallback(
    (setup: MatchSetup) => {
      persistPrefs({ ...prefs, lastSetup: setup })
      startNewMatch({
        blueName: setup.blueName,
        redName: setup.redName,
        totalRounds: setup.totalRounds,
        roundDurationMs: setup.roundDurationMs,
        restDurationMs: setup.restDurationMs,
        ruleSetCode: setup.ruleSetCode,
        soundEnabled: prefs.soundEnabled,
        vibrationEnabled: prefs.vibrationEnabled,
      })
      setShowSetup(false)
      setRestoreDismissed(true)
      searchParams.delete('setup')
      setSearchParams(searchParams, { replace: true })
    },
    [persistPrefs, prefs, searchParams, setSearchParams, startNewMatch],
  )

  const confirmDanger = useCallback(() => {
    if (danger === 'FINISH') dispatch({ type: 'FINISH' })
    if (danger === 'RESTART') dispatch({ type: 'RESTART' })
    if (danger === 'CLEAR') resetAll()
    if (danger === 'DISCARD_RESTORED') {
      resetAll()
      setShowSetup(true)
    }
    setDanger(null)
    setShowMenu(false)
  }, [danger, dispatch, resetAll])

  const rejectionMessage = useMemo(() => {
    if (lastRejection === null) return null
    if (now - lastRejection.at > 2_500) return null
    return REJECTION_TEXT[lastRejection.reason as CommandRejection] ?? '操作被拒絕'
  }, [lastRejection, now])

  const recordToast = useMemo(() => {
    if (lastFlash === null) return null
    if (now - lastFlash.event.createdAt > TOAST_MS) return null
    return lastFlash.event
  }, [lastFlash, now])

  /* ---------------- 畫面 ---------------- */

  if (showSetup) {
    return (
      <SetupPanel
        initial={prefs.lastSetup}
        onStart={handleStartSetup}
        onCancel={() => {
          setShowSetup(false)
          searchParams.delete('setup')
          setSearchParams(searchParams, { replace: true })
        }}
      />
    )
  }

  return (
    <div className="safe-area flex h-dvh w-full flex-col overflow-hidden bg-ink">
      {rejectionMessage !== null && (
        <div
          role="alert"
          className="pointer-events-none fixed top-2 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-lg"
        >
          {rejectionMessage}
        </div>
      )}

      {recordToast !== null && rejectionMessage === null && (
        <div
          role="status"
          className="fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-800/95 px-3 py-2 text-sm font-bold text-white shadow-lg"
        >
          <span>已記錄：{describeEvent(recordToast)}</span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'REVERSE_EVENT', eventId: recordToast.id })}
            className="min-h-[36px] rounded bg-slate-600 px-3 font-bold focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            復原
          </button>
        </div>
      )}

      {!mirrorMode && (
        <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-2 py-1">
          <Link
            to="/"
            className="rounded px-2 py-1 text-sm font-bold text-slate-300 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            ← 首頁
          </Link>
          <span className="text-sm font-bold text-slate-400">單手機計分</span>
          <span className="ml-auto text-xs text-slate-500">
            {state.config.blueName} {state.roundWins.blue}–{state.roundWins.red}{' '}
            {state.config.redName}
          </span>
        </header>
      )}

      <main className={mirrorMode ? 'min-h-0 flex-1' : 'min-h-0 flex-[1.05]'}>
        <Scoreboard
          state={state}
          remainingMs={remainingMs}
          flash={lastFlash}
          compact={!mirrorMode}
          onToggleTimer={
            mirrorMode
              ? undefined
              : () => {
                  touch()
                  dispatch({ type: running ? 'PAUSE' : 'START' })
                }
          }
        />
      </main>

      {mirrorMode ? (
        <button
          type="button"
          onClick={() => setMirrorMode(false)}
          className="min-h-[56px] w-full shrink-0 border-t border-line bg-panel text-sm font-bold text-slate-400"
        >
          點此顯示操作面板
        </button>
      ) : (
        <div
          onPointerDown={touch}
          className={`min-h-0 flex-[1.35] transition-opacity duration-500 ${
            idle ? 'opacity-40' : 'opacity-100'
          }`}
        >
          <ControlPanel
            state={state}
            inLastSeconds={inLastSeconds}
            correctionMode={correctionMode}
            undoTarget={undoTarget}
            onScore={handleScore}
            onGamjeom={handleGamjeom}
            onSpecialGamjeom={handleSpecialGamjeom}
            onToggleTimer={() => {
              touch()
              dispatch({ type: running ? 'PAUSE' : 'START' })
            }}
            onUndo={() => {
              touch()
              dispatch({ type: 'UNDO' })
            }}
            onToggleCorrection={() => {
              touch()
              setCorrectionStartedAt(Date.now())
              setCorrectionMode((current) => !current)
            }}
            onEndRound={() => dispatch({ type: 'NEXT_ROUND' })}
            onOpenMenu={() => setShowMenu(true)}
          />
        </div>
      )}

      <RoundEndPanel
        state={state}
        restRemainingMs={computeRemainingMs(state.timer, now)}
        onStartRest={() => dispatch({ type: 'START' })}
        onSkipRest={() => dispatch({ type: 'NEXT_ROUND' })}
        onFixResult={() => dispatch({ type: 'PREV_ROUND' })}
        onRestart={() => setDanger('RESTART')}
        onDecideSuperiority={(winner) => dispatch({ type: 'DECIDE_SUPERIORITY', winner })}
      />

      {showRestoreBanner && (
        <div className="safe-area fixed inset-x-0 top-0 z-40 border-b-2 border-emerald-500/60 bg-panel/95 p-3">
          <p className="text-sm font-bold">已恢復上一場比賽</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {state.config.blueName} {state.scores.blueScore} : {state.scores.redScore}{' '}
            {state.config.redName} · 第 {state.currentRound} 回合
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ActionButton tone="primary" onClick={() => setRestoreDismissed(true)}>
              繼續比賽
            </ActionButton>
            <ActionButton tone="danger" onClick={() => setDanger('DISCARD_RESTORED')}>
              放棄並重新開始
            </ActionButton>
          </div>
        </div>
      )}

      {showMenu && (
        <MenuDrawer
          state={state}
          prefs={prefs}
          isFullscreen={isFullscreen}
          onClose={() => setShowMenu(false)}
          onOpenLog={() => {
            setShowMenu(false)
            setShowLog(true)
          }}
          onMirror={() => {
            setShowMenu(false)
            setMirrorMode(true)
            if (!isFullscreen) toggleFullscreen()
          }}
          onFullscreen={toggleFullscreen}
          onNewMatch={() => {
            setShowMenu(false)
            setShowSetup(true)
          }}
          onFinish={() => setDanger('FINISH')}
          onRestart={() => setDanger('RESTART')}
          onClear={() => setDanger('CLEAR')}
          onRename={(side, name) => dispatch({ type: 'RENAME', side, name })}
          onSwap={() => dispatch({ type: 'SWAP_SIDES' })}
          onTogglePref={(key) => {
            const next = { ...prefs, [key]: !prefs[key] }
            persistPrefs(next)
            dispatch({
              type: 'SET_OPTIONS',
              soundEnabled: next.soundEnabled,
              vibrationEnabled: next.vibrationEnabled,
            })
          }}
        />
      )}

      {showLog && (
        <EventLogDrawer
          state={state}
          onClose={() => setShowLog(false)}
          onReverse={(id) => dispatch({ type: 'REVERSE_EVENT', eventId: id })}
        />
      )}

      {danger !== null && (
        <ConfirmModal
          title={
            danger === 'FINISH'
              ? '結束比賽？'
              : danger === 'RESTART'
                ? '重新開賽？'
                : danger === 'CLEAR'
                  ? '清除本機所有比賽紀錄？'
                  : '放棄已恢復的比賽？'
          }
          description={
            danger === 'FINISH' ? (
              <>
                將立即結束整場比賽，之後<b>所有計分按鈕都會停用</b>。
                比分與紀錄會保留，可從選單重新開賽。
              </>
            ) : danger === 'RESTART' ? (
              <>
                將清除<b>目前比分、Gam-jeom、回合戰績與所有得分紀錄</b>，
                但保留雙方姓名與比賽設定。此動作無法復原。
              </>
            ) : danger === 'CLEAR' ? (
              <>
                將刪除本機保存的<b>整場比賽資料與所有事件紀錄</b>。
                音效與震動偏好會保留。此動作無法復原。
              </>
            ) : (
              <>將刪除剛才恢復的那場比賽，並前往「設定新比賽」。此動作無法復原。</>
            )
          }
          confirmLabel={danger === 'CLEAR' ? '確定清除' : '確定'}
          onConfirm={confirmDanger}
          onCancel={() => setDanger(null)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface MenuDrawerProps {
  state: MatchState
  prefs: ReturnType<typeof loadPreferences>
  isFullscreen: boolean
  onClose: () => void
  onOpenLog: () => void
  onMirror: () => void
  onFullscreen: () => void
  onNewMatch: () => void
  onFinish: () => void
  onRestart: () => void
  onClear: () => void
  onRename: (side: AthleteSide, name: string) => void
  onSwap: () => void
  onTogglePref: (key: 'soundEnabled' | 'vibrationEnabled') => void
}

function MenuDrawer({
  state,
  prefs,
  isFullscreen,
  onClose,
  onOpenLog,
  onMirror,
  onFullscreen,
  onNewMatch,
  onFinish,
  onRestart,
  onClear,
  onRename,
  onSwap,
  onTogglePref,
}: MenuDrawerProps): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/70"
      role="dialog"
      aria-label="選單"
      onClick={onClose}
    >
      <div
        className="safe-area max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t-2 border-line bg-panel p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">選單</h2>
          <ActionButton tone="ghost" className="min-h-[44px] px-3" onClick={onClose}>
            關閉
          </ActionButton>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ActionButton tone="neutral" onClick={onOpenLog}>
            得分紀錄
          </ActionButton>
          <ActionButton tone="neutral" onClick={onMirror}>
            鏡射模式
          </ActionButton>
          <ActionButton tone="neutral" onClick={onFullscreen}>
            {isFullscreen ? '離開全螢幕' : '全螢幕'}
          </ActionButton>
          <ActionButton tone="neutral" onClick={onSwap}>
            交換藍紅姓名
          </ActionButton>
          <ActionButton
            tone={prefs.soundEnabled ? 'primary' : 'ghost'}
            onClick={() => onTogglePref('soundEnabled')}
          >
            音效：{prefs.soundEnabled ? '開' : '關'}
          </ActionButton>
          <ActionButton
            tone={prefs.vibrationEnabled ? 'primary' : 'ghost'}
            onClick={() => onTogglePref('vibrationEnabled')}
          >
            震動：{prefs.vibrationEnabled ? '開' : '關'}
          </ActionButton>
        </div>

        <div className="mt-3 grid gap-2">
          {(['BLUE', 'RED'] as const).map((side) => (
            <label key={side} className="flex items-center gap-2">
              <span className="w-16 text-sm font-bold">{sideLabel(side)}姓名</span>
              <input
                className="min-h-[56px] flex-1 rounded-lg border border-line bg-panel-2 px-3 text-base"
                defaultValue={side === 'BLUE' ? state.config.blueName : state.config.redName}
                maxLength={12}
                onChange={(event) => onRename(side, event.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="mt-4 grid gap-2 border-t border-line pt-3">
          <ActionButton tone="neutral" onClick={onNewMatch}>
            設定新比賽
          </ActionButton>
          <ActionButton tone="danger" onClick={onFinish}>
            結束比賽
          </ActionButton>
          <ActionButton tone="danger" onClick={onRestart}>
            重新開賽（清除比分）
          </ActionButton>
          <ActionButton tone="ghost" onClick={onClear}>
            清除本機所有紀錄
          </ActionButton>
        </div>

        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          ⚠️ 本系統供訓練賽及模擬賽使用，非 WT 認證競賽設備。規則版本{' '}
          {getRuleSet(state.config.ruleSetCode).effectiveDate}。
        </p>
      </div>
    </div>
  )
}

function EventLogDrawer({
  state,
  onClose,
  onReverse,
}: {
  state: MatchState
  onClose: () => void
  onReverse: (id: string) => void
}): React.ReactElement {
  const reversed = reversedEventIds(state.events)
  const items = [...state.events].reverse()

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      role="dialog"
      aria-label="得分紀錄"
      onClick={onClose}
    >
      <div
        className="safe-area h-full w-full max-w-md overflow-y-auto bg-panel p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">得分紀錄（{state.events.length}）</h2>
          <ActionButton tone="ghost" className="min-h-[44px] px-3" onClick={onClose}>
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
                    aria-label={`復原 ${shortDescribeEvent(event)}`}
                    className="min-h-[36px] rounded bg-slate-700 px-3 text-xs font-bold focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
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
