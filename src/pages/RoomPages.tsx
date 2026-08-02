import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Scoreboard } from '../components/Scoreboard'
import { ControlPanel } from '../components/ControlPanel'
import { SideControls } from '../components/ScoreButtons'
import { RoundEndPanel } from '../components/RoundEndPanel'
import { ActionButton } from '../components/ui'
import { useNow } from '../hooks/useNow'
import { useWakeLock } from '../hooks/useFullscreen'
import { useRoomHost, useRoomClient } from '../room/useRoom'
import { loadRoom } from '../room/roomStorage'
import { computeRemainingMs } from '../timer/timer'
import { findLastReversibleEvent } from '../rules/ruleEngine'
import { getRuleSet } from '../rules/ruleSets'
import type { ActionType, AthleteSide, JudgeSeat, PressOutcome } from '../types'

function useRoomCode(): string {
  const params = useParams()
  return (typeof params.roomCode === 'string' ? params.roomCode : '').toUpperCase()
}

function RoomMissing({ roomCode }: { roomCode: string }): React.ReactElement {
  return (
    <div className="safe-area flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-black">找不到房間 {roomCode}</h1>
      <p className="max-w-md text-sm text-slate-400">
        房間可能已過期（4 小時），或這台裝置的瀏覽器沒有這個房間。
        目前為<b>本機模擬模式</b>，房間只在建立它的那個瀏覽器內有效。
      </p>
      <Link to="/create" className="min-h-[56px] rounded-lg bg-emerald-600 px-5 py-3 font-bold">
        重新建立房間
      </Link>
    </div>
  )
}

/* ================================================================== */
/* 電視顯示端                                                          */
/* ================================================================== */

export function DisplayPage(): React.ReactElement {
  const roomCode = useRoomCode()
  const now = useNow(100)
  const { snapshot, connected } = useRoomClient(roomCode, 'DISPLAY', null)
  useWakeLock(true)

  const fallback = useMemo(() => loadRoom(roomCode), [roomCode])
  const match = snapshot?.match ?? fallback?.match ?? null
  if (match === null) return <RoomMissing roomCode={roomCode} />

  const judges = (snapshot?.presences ?? []).filter((p) => p.role === 'JUDGE')

  return (
    <div className="h-dvh w-full">
      <Scoreboard
        state={match}
        remainingMs={computeRemainingMs(match.timer, now)}
        flash={null}
        statusSlot={
          <div className="flex flex-wrap items-center justify-center gap-1 text-[clamp(0.5rem,1.5vh,0.8rem)]">
            <span
              className={`rounded px-2 py-0.5 font-bold ${
                connected ? 'bg-emerald-600/30 text-emerald-300' : 'bg-rose-600 text-white'
              }`}
            >
              {connected ? `房間 ${roomCode}` : '連線中斷，顯示最後正式比分'}
            </span>
            {(['A', 'B'] as const).map((seat) => {
              const online = judges.some((j) => j.judgeSeat === seat)
              return (
                <span
                  key={seat}
                  className={`rounded px-2 py-0.5 font-bold ${
                    online ? 'bg-emerald-600/30 text-emerald-300' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  裁判{seat} {online ? '在線' : '離線'}
                </span>
              )
            })}
          </div>
        }
      />
    </div>
  )
}

/* ================================================================== */
/* 主控端（本機模擬伺服器）                                            */
/* ================================================================== */

export function OperatorPage(): React.ReactElement {
  const roomCode = useRoomCode()
  const now = useNow(100)
  const { config, state, presences, dispatch, notFound } = useRoomHost(roomCode)
  const [pinInput, setPinInput] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [correctionMode, setCorrectionMode] = useState(false)
  useWakeLock(unlocked)

  if (notFound || config === null) return <RoomMissing roomCode={roomCode} />

  if (!unlocked) {
    return (
      <div className="safe-area mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-black">主控端</h1>
        <p className="text-sm text-slate-400">
          房間 <b className="tabular text-white">{roomCode}</b>。請輸入主控 PIN。
        </p>
        <input
          className="min-h-[64px] rounded-lg border-2 border-line bg-panel-2 px-4 text-2xl tabular"
          inputMode="numeric"
          value={pinInput}
          aria-label="主控 PIN"
          onChange={(event) => setPinInput(event.target.value)}
        />
        <ActionButton
          tone="primary"
          className="min-h-[64px]"
          onClick={() => setUnlocked(pinInput.trim() === config.hostPin)}
        >
          進入主控
        </ActionButton>
        {pinInput !== '' && pinInput.trim() !== config.hostPin && (
          <p role="alert" className="text-sm font-bold text-rose-400">
            PIN 不正確
          </p>
        )}
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          ⚠️ 模擬模式下 PIN 在本機比對，<b>不是真正的安全機制</b>。
          第三階段會改由伺服器 RPC 驗證並發放短期 token。
        </p>
      </div>
    )
  }

  const remainingMs = computeRemainingMs(state.timer, now)
  const rules = getRuleSet(state.config.ruleSetCode)
  const inLastSeconds =
    state.matchStatus === 'RUNNING' && remainingMs > 0 && remainingMs <= rules.gamjeom.lastSecondsWindowMs
  const running = state.timer.timerStatus === 'RUNNING'
  const judgeSeats: JudgeSeat[] = config.judgeMode === 'SINGLE' ? ['A'] : ['A', 'B']

  return (
    <div className="safe-area flex h-dvh w-full flex-col overflow-hidden bg-ink">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-2 py-1 text-xs">
        <Link to="/" className="font-bold text-slate-300">
          ← 首頁
        </Link>
        <span className="font-bold text-slate-400">
          主控 · 房間 <b className="tabular text-white">{roomCode}</b>
        </span>
        <span className="ml-auto flex gap-1">
          {judgeSeats.map((seat) => {
            const online = presences.some((p) => p.role === 'JUDGE' && p.judgeSeat === seat)
            return (
              <span
                key={seat}
                className={`rounded px-2 py-0.5 font-bold ${
                  online ? 'bg-emerald-600/30 text-emerald-300' : 'bg-slate-700 text-slate-400'
                }`}
              >
                裁判{seat}
              </span>
            )
          })}
          <span
            className={`rounded px-2 py-0.5 font-bold ${
              presences.some((p) => p.role === 'DISPLAY')
                ? 'bg-emerald-600/30 text-emerald-300'
                : 'bg-slate-700 text-slate-400'
            }`}
          >
            電視
          </span>
        </span>
      </header>

      <main className="min-h-0 flex-1">
        <Scoreboard
          state={state}
          remainingMs={remainingMs}
          flash={null}
          compact
          onToggleTimer={() => dispatch({ type: running ? 'PAUSE' : 'START' })}
        />
      </main>

      <div className="min-h-0 flex-[1.2]">
        <ControlPanel
          state={state}
          inLastSeconds={inLastSeconds}
          correctionMode={correctionMode}
          undoTarget={findLastReversibleEvent(state.events)}
          onScore={(side, action) => {
            // 主控端的手動加分僅供修正之用，正式得分應由裁判端送出
            dispatch({ type: 'SCORE', side, action, source: 'OPERATOR' })
            return true
          }}
          onGamjeom={(side) => dispatch({ type: 'GAMJEOM', side, reason: 'OTHER', special: false })}
          onSpecialGamjeom={(side) =>
            dispatch({ type: 'GAMJEOM', side, reason: 'AVOIDING', special: true })
          }
          onToggleTimer={() => dispatch({ type: running ? 'PAUSE' : 'START' })}
          onUndo={() => dispatch({ type: 'UNDO' })}
          onToggleCorrection={() => setCorrectionMode((current) => !current)}
          onEndRound={() => dispatch({ type: 'NEXT_ROUND' })}
          onOpenMenu={() => dispatch({ type: 'SWAP_SIDES' })}
        />
      </div>

      <RoundEndPanel
        state={state}
        restRemainingMs={remainingMs}
        onStartRest={() => dispatch({ type: 'START' })}
        onSkipRest={() => dispatch({ type: 'NEXT_ROUND' })}
        onFixResult={() => dispatch({ type: 'PREV_ROUND' })}
        onRestart={() => dispatch({ type: 'RESTART' })}
        onDecideSuperiority={(winner) => dispatch({ type: 'DECIDE_SUPERIORITY', winner })}
      />
    </div>
  )
}

/* ================================================================== */
/* 裁判端                                                              */
/* ================================================================== */

const OUTCOME_TEXT: Record<PressOutcome['status'], string> = {
  MATCHED: '得分成立',
  WAITING: '等待另一位裁判確認',
  EXPIRED: '確認時間已過',
  REJECTED: '未獲確認',
  DUPLICATE: '已送出，未重複計分',
}

export function JudgePage(): React.ReactElement {
  const roomCode = useRoomCode()
  const params = useParams()
  const seat: JudgeSeat = params.seat === 'B' ? 'B' : params.seat === 'C' ? 'C' : 'A'
  const now = useNow(200)
  const { snapshot, connected, sendPress, outcomes } = useRoomClient(roomCode, 'JUDGE', seat)
  const [lastEventId, setLastEventId] = useState<string | null>(null)
  const [lastPressAt, setLastPressAt] = useState(0)
  useWakeLock(true)

  const match = snapshot?.match ?? null
  const outcome = lastEventId === null ? undefined : outcomes[lastEventId]
  const showOutcome = lastPressAt > 0 && now - lastPressAt < 2_500

  const handlePress = (side: AthleteSide, action: ActionType): boolean => {
    const id = sendPress(side, action)
    if (id === null) return false
    setLastEventId(id)
    setLastPressAt(Date.now())
    return true
  }

  if (match === null) {
    return (
      <div className="safe-area flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-black">裁判 {seat}</h1>
        <p className="text-sm text-slate-400">
          房間 <b className="tabular text-white">{roomCode}</b>：等待主控端連線中…
        </p>
        <p className="max-w-md text-xs text-slate-500">
          本機模擬模式下，主控端分頁必須保持開啟。
        </p>
      </div>
    )
  }

  const remainingMs = computeRemainingMs(match.timer, now)
  const rules = getRuleSet(match.config.ruleSetCode)
  const inLastSeconds =
    match.matchStatus === 'RUNNING' && remainingMs > 0 && remainingMs <= rules.gamjeom.lastSecondsWindowMs

  return (
    <div className="safe-area flex h-dvh w-full flex-col overflow-hidden bg-ink">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-2 py-1 text-xs">
        <span className="font-black">裁判 {seat}</span>
        <span className="tabular text-slate-400">房間 {roomCode}</span>
        <span className="text-slate-400">
          第 {match.currentRound} 回合 · {(remainingMs / 1000).toFixed(1)} 秒
        </span>
        <span
          className={`ml-auto rounded px-2 py-0.5 font-bold ${
            connected ? 'bg-emerald-600/30 text-emerald-300' : 'bg-rose-600 text-white'
          }`}
        >
          {connected ? '已連線' : '未連線，無法送分'}
        </span>
        {match.matchStatus !== 'RUNNING' && (
          <span className="rounded bg-amber-600/30 px-2 py-0.5 font-bold text-amber-200">
            {match.matchStatus === 'PAUSED' ? '比賽暫停中' : '比賽未進行'}
          </span>
        )}
      </header>

      {showOutcome && outcome !== undefined && (
        <div
          role="status"
          className={`shrink-0 px-2 py-1 text-center text-sm font-black ${
            outcome.status === 'MATCHED'
              ? 'bg-emerald-600 text-white'
              : outcome.status === 'WAITING'
                ? 'bg-amber-600 text-black'
                : 'bg-slate-700 text-slate-200'
          }`}
        >
          {OUTCOME_TEXT[outcome.status]}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-1 p-1">
        <SideControls
          side="BLUE"
          ruleSetCode={match.config.ruleSetCode}
          disabled={!connected}
          onPress={handlePress}
          onGamjeom={() => {}}
          onSpecialGamjeom={() => {}}
          specialGamjeomEnabled={false}
          hideGamjeom
        />
        <SideControls
          side="RED"
          ruleSetCode={match.config.ruleSetCode}
          disabled={!connected}
          onPress={handlePress}
          onGamjeom={() => {}}
          onSpecialGamjeom={() => {}}
          specialGamjeomEnabled={false}
          hideGamjeom
        />
      </div>

      <p className="shrink-0 bg-panel px-2 py-1 text-center text-[0.65rem] text-slate-500">
        裁判端只能送出得分；計時、Gam-jeom、修改姓名與結束比賽都在主控端。
        {inLastSeconds && ' · 進入最後 10 秒'}
      </p>
    </div>
  )
}
