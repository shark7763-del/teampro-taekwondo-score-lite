import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Scoreboard } from '../components/Scoreboard'
import { ControlPanel } from '../components/ControlPanel'
import { SideControls } from '../components/ScoreButtons'
import { RoundEndPanel } from '../components/RoundEndPanel'
import { SetupPanel } from '../components/SetupPanel'
import { QrCode } from '../components/QrCode'
import { ActionButton, NonCertifiedNotice } from '../components/ui'
import { useNow } from '../hooks/useNow'
import { useFullscreen, useWakeLock } from '../hooks/useFullscreen'
import { useRoomHost, useRoomClient } from '../room/useRoom'
import { createRoomConfig, generateRoomCode } from '../room/roomStorage'
import { displayLink, judgeLink, operatorLink, shortHostUrl } from '../room/links'
import type { RoomTransport } from '../room/roomChannel'
import { createMatchState } from '../match/matchCore'
import { computeRemainingMs } from '../timer/timer'
import { findLastReversibleEvent } from '../rules/ruleEngine'
import { getRuleSet } from '../rules/ruleSets'
import { loadPreferences, savePreferences } from '../storage/preferences'
import type { ActionType, AthleteSide, JudgeSeat, PressOutcome } from '../types'

function useRoomCode(): string {
  const params = useParams()
  return (typeof params.roomCode === 'string' ? params.roomCode : '').toUpperCase()
}

/** 目前用哪一種方式連線，任何多裝置頁面都必須誠實顯示 */
function TransportBadge({
  transport,
  ready,
  className = '',
}: {
  transport: RoomTransport
  ready: boolean
  className?: string
}): React.ReactElement {
  const label =
    transport === 'cloud'
      ? ready
        ? '雲端連線'
        : '雲端連線中…'
      : transport === 'local'
        ? '本機模擬（僅同一瀏覽器）'
        : '此瀏覽器不支援連線'
  const tone =
    transport === 'cloud'
      ? ready
        ? 'bg-emerald-600/30 text-emerald-300'
        : 'bg-amber-600/30 text-amber-200'
      : 'bg-amber-600/30 text-amber-200'
  return <span className={`rounded px-2 py-0.5 font-bold ${tone} ${className}`}>{label}</span>
}

function LocalModeWarning(): React.ReactElement {
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
      ⚠️ <b>尚未設定雲端連線</b>，目前只有<b>同一台裝置的同一個瀏覽器</b>能互通， 用另一支手機掃 QR
      Code 會連不上。 請在專案根目錄的 <code>.env</code> 填入 <code>VITE_SUPABASE_URL</code> 與{' '}
      <code>VITE_SUPABASE_ANON_KEY</code> 後重新建置。
    </p>
  )
}

/* ================================================================== */
/* 電視顯示端                                                          */
/* ================================================================== */

/**
 * 電視端。
 *
 * 電視是現場最穩定、最早打開的那一台，所以由它產生房間代碼並顯示 QR Code；
 * 教練用手機掃碼就直接進入主控端，不需要在電視上打字。
 */
export function DisplayPage(): React.ReactElement {
  const code = useRoomCode()
  const [generated] = useState(() => generateRoomCode())
  if (code === '') return <Navigate to={`/display/${generated}`} replace />
  return <TvDisplay roomCode={code} />
}

function TvDisplay({ roomCode }: { roomCode: string }): React.ReactElement {
  const now = useNow(100)
  const { snapshot, connected, transport, ready, clockOffsetMs } = useRoomClient(
    roomCode,
    'DISPLAY',
    null,
  )
  const { isFullscreen, toggle } = useFullscreen()
  useWakeLock(true)

  const match = snapshot?.match ?? null

  const fullscreenButton = (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg border border-line bg-panel-2/80 px-3 py-2 text-sm font-bold text-slate-200 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
    >
      {isFullscreen ? '離開全螢幕' : '全螢幕'}
    </button>
  )

  if (match === null) {
    return (
      <div className="safe-area flex min-h-dvh w-full flex-col justify-center gap-6 p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-8 md:flex-row md:items-center md:justify-center">
          <QrCode
            value={operatorLink(roomCode)}
            label="用手機掃我開始計分"
            size={240}
            showCopy={false}
          />

          <div className="flex flex-col items-center gap-2 md:items-start">
            <p className="text-sm font-bold tracking-[0.3em] text-emerald-400">
              TEAMPRO 跆拳道計分
            </p>
            <p className="text-lg text-slate-300">房間代碼</p>
            <p className="tabular text-[clamp(3.5rem,12vw,9rem)] leading-none font-black tracking-[0.15em]">
              {roomCode}
            </p>
            <p className="max-w-md text-center text-sm text-slate-400 md:text-left">
              手機無法掃描時，請在手機瀏覽器開啟 <b className="text-slate-200">{shortHostUrl()}</b>
              ， 點「手機主控」後輸入上面的房間代碼。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <TransportBadge transport={transport} ready={ready} />
              {fullscreenButton}
              <Link to="/" className="px-2 py-2 text-slate-400 underline">
                回首頁
              </Link>
            </div>
          </div>
        </div>

        {transport !== 'cloud' && (
          <div className="mx-auto w-full max-w-3xl">
            <LocalModeWarning />
          </div>
        )}
        <div className="mx-auto w-full max-w-3xl">
          <NonCertifiedNotice />
        </div>
      </div>
    )
  }

  const judges = (snapshot?.presences ?? []).filter((p) => p.role === 'JUDGE')
  // 剩餘時間必須用主控端的時間軸換算，否則兩台裝置的系統時鐘差幾秒就會對不起來
  const hostNow = now + clockOffsetMs

  return (
    <div className="relative h-dvh w-full">
      <Scoreboard
        state={match}
        remainingMs={computeRemainingMs(match.timer, hostNow)}
        flash={null}
        statusSlot={
          <div className="flex flex-wrap items-center justify-center gap-1 text-[clamp(0.5rem,1.5vh,0.8rem)]">
            <span
              className={`rounded px-2 py-0.5 font-bold ${
                connected ? 'bg-emerald-600/30 text-emerald-300' : 'bg-rose-600 text-white'
              }`}
            >
              {connected ? `房間 ${roomCode}` : '主控端未連線，顯示最後正式比分'}
            </span>
            {judges.map((judge) => (
              <span
                key={judge.deviceId}
                className="rounded bg-emerald-600/30 px-2 py-0.5 font-bold text-emerald-300"
              >
                裁判{judge.judgeSeat} 在線
              </span>
            ))}
          </div>
        }
      />
      <div className="absolute top-2 right-2 opacity-40 transition-opacity hover:opacity-100 focus-within:opacity-100">
        {fullscreenButton}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 主控端（手機）                                                      */
/* ================================================================== */

export function OperatorPage(): React.ReactElement {
  const roomCode = useRoomCode()
  const now = useNow(100)
  const { config, state, presences, transport, ready, dispatch, initialize, updateConfig } =
    useRoomHost(roomCode)
  const [correctionMode, setCorrectionMode] = useState(false)
  const [showLinks, setShowLinks] = useState(false)
  useWakeLock(state !== null)

  /* 尚未建立比賽（例如剛掃完電視上的 QR Code）：先設定選手與時間 */
  if (config === null || state === null) {
    return (
      <OperatorSetup roomCode={roomCode} transport={transport} ready={ready} onStart={initialize} />
    )
  }

  const remainingMs = computeRemainingMs(state.timer, now)
  const rules = getRuleSet(state.config.ruleSetCode)
  const inLastSeconds =
    state.matchStatus === 'RUNNING' &&
    remainingMs > 0 &&
    remainingMs <= rules.gamjeom.lastSecondsWindowMs
  const running = state.timer.timerStatus === 'RUNNING'
  const judgeSeats: JudgeSeat[] = config.judgeMode === 'SINGLE' ? ['A'] : ['A', 'B']
  const displayOnline = presences.some((p) => p.role === 'DISPLAY')

  return (
    <div className="safe-area flex h-dvh w-full flex-col overflow-hidden bg-ink">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-2 py-1 text-xs">
        <Link to="/" className="font-bold text-slate-300">
          ← 首頁
        </Link>
        <button
          type="button"
          onClick={() => setShowLinks(true)}
          className="rounded bg-panel-2 px-2 py-1 font-bold text-slate-200"
        >
          房間 <b className="tabular text-white">{roomCode}</b> · 連線
        </button>
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
              displayOnline ? 'bg-emerald-600/30 text-emerald-300' : 'bg-slate-700 text-slate-400'
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

      {showLinks && (
        <ConnectionSheet
          roomCode={roomCode}
          transport={transport}
          ready={ready}
          singleJudge={config.judgeMode === 'SINGLE'}
          onToggleJudgeMode={() =>
            updateConfig({ judgeMode: config.judgeMode === 'SINGLE' ? 'DUAL' : 'SINGLE' })
          }
          onClose={() => setShowLinks(false)}
        />
      )}
    </div>
  )
}

/** 主控端第一次進入房間時的設定畫面 */
function OperatorSetup({
  roomCode,
  transport,
  ready,
  onStart,
}: {
  roomCode: string
  transport: RoomTransport
  ready: boolean
  onStart: ReturnType<typeof useRoomHost>['initialize']
}): React.ReactElement {
  const navigate = useNavigate()
  const [prefs] = useState(() => loadPreferences())
  const rules = getRuleSet(prefs.lastSetup.ruleSetCode)

  return (
    <div className="min-h-dvh">
      <div className="safe-area mx-auto flex w-full max-w-lg flex-col gap-2 px-4 pt-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-panel-2 px-2 py-0.5 font-bold">
            房間 <b className="tabular text-white">{roomCode}</b>
          </span>
          <TransportBadge transport={transport} ready={ready} />
        </div>
        {transport !== 'cloud' && <LocalModeWarning />}
      </div>
      <SetupPanel
        initial={prefs.lastSetup}
        onCancel={() => void navigate('/')}
        onStart={(setup) => {
          savePreferences({ ...prefs, lastSetup: setup })
          const config = createRoomConfig({
            roomCode,
            judgeMode: 'SINGLE',
            confirmationWindowMs: rules.trainingDefaults.confirmationWindowMs,
          })
          const match = createMatchState({
            blueName: setup.blueName.trim() === '' ? '藍方' : setup.blueName.trim(),
            redName: setup.redName.trim() === '' ? '紅方' : setup.redName.trim(),
            totalRounds: setup.totalRounds,
            roundDurationMs: setup.roundDurationMs,
            restDurationMs: setup.restDurationMs,
            ruleSetCode: setup.ruleSetCode,
            judgeMode: 'SINGLE',
            confirmationWindowMs: rules.trainingDefaults.confirmationWindowMs,
            soundEnabled: prefs.soundEnabled,
            vibrationEnabled: prefs.vibrationEnabled,
          })
          onStart(config, match)
        }}
      />
    </div>
  )
}

/** 主控端的連線面板：電視、裁判連結與單／雙裁判切換 */
function ConnectionSheet({
  roomCode,
  transport,
  ready,
  singleJudge,
  onToggleJudgeMode,
  onClose,
}: {
  roomCode: string
  transport: RoomTransport
  ready: boolean
  singleJudge: boolean
  onToggleJudgeMode: () => void
  onClose: () => void
}): React.ReactElement {
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink/95 p-4">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-black">
            房間 <span className="tabular">{roomCode}</span>
          </h2>
          <ActionButton tone="ghost" className="min-h-[44px] px-3 text-sm" onClick={onClose}>
            關閉
          </ActionButton>
        </header>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <TransportBadge transport={transport} ready={ready} />
        </div>
        {transport !== 'cloud' && <LocalModeWarning />}

        <p className="text-sm text-slate-400">
          電視如果還沒開，請在電視瀏覽器開啟 <b className="text-slate-200">{shortHostUrl()}</b>
          ，點「電視顯示」後輸入房間代碼；或直接掃下面的 QR Code。
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <QrCode value={displayLink(roomCode)} label="電視顯示端" />
          <QrCode value={judgeLink(roomCode, 'A')} label="裁判 A" />
          {!singleJudge && <QrCode value={judgeLink(roomCode, 'B')} label="裁判 B" />}
        </div>

        <ActionButton tone="neutral" onClick={onToggleJudgeMode}>
          {singleJudge ? '切換為雙裁判（兩人確認才得分）' : '切換為單裁判（按下即得分）'}
        </ActionButton>
        <p className="text-xs text-slate-500">
          裁判端只負責送出得分；計時、Gam-jeom 與結束比賽一律在主控端。
          雙裁判模式下，兩位裁判必須在確認時間窗內按下<b>相同選手、相同技術</b>才會加分一次
          （確認時間窗為本系統訓練參數，非 WT 規定）。
        </p>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 加入房間（手機手動輸入房號）                                        */
/* ================================================================== */

export function JoinPage(): React.ReactElement {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const normalized = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
  const valid = normalized.length === 6

  return (
    <div className="safe-area mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 p-4">
      <Link to="/" className="text-sm font-bold text-slate-400">
        ← 回首頁
      </Link>
      <h1 className="text-2xl font-black">輸入房間代碼</h1>
      <p className="text-sm text-slate-400">電視畫面上顯示的 6 碼代碼。</p>
      <input
        className="tabular min-h-[72px] rounded-lg border-2 border-line bg-panel-2 px-4 text-center text-4xl font-black tracking-[0.2em] uppercase"
        value={normalized}
        aria-label="房間代碼"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => setCode(event.target.value)}
      />
      <ActionButton
        tone="primary"
        className="min-h-[64px]"
        disabled={!valid}
        onClick={() => void navigate(`/operator/${normalized}`)}
      >
        我是主控（手機計分）
      </ActionButton>
      <ActionButton
        tone="neutral"
        disabled={!valid}
        onClick={() => void navigate(`/display/${normalized}`)}
      >
        這台是電視顯示端
      </ActionButton>
      <ActionButton
        tone="neutral"
        disabled={!valid}
        onClick={() => void navigate(`/judge/${normalized}/A`)}
      >
        我是裁判 A
      </ActionButton>
      <ActionButton
        tone="neutral"
        disabled={!valid}
        onClick={() => void navigate(`/judge/${normalized}/B`)}
      >
        我是裁判 B
      </ActionButton>
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
  const { snapshot, connected, transport, ready, clockOffsetMs, sendPress, outcomes } =
    useRoomClient(roomCode, 'JUDGE', seat)
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
        <TransportBadge transport={transport} ready={ready} className="text-xs" />
        <p className="max-w-md text-xs text-slate-500">
          主控端（教練的手機）必須保持開啟，它是這場比賽的計分來源。
        </p>
        {transport !== 'cloud' && (
          <div className="max-w-md">
            <LocalModeWarning />
          </div>
        )}
      </div>
    )
  }

  const hostNow = now + clockOffsetMs
  const remainingMs = computeRemainingMs(match.timer, hostNow)
  const rules = getRuleSet(match.config.ruleSetCode)
  const inLastSeconds =
    match.matchStatus === 'RUNNING' &&
    remainingMs > 0 &&
    remainingMs <= rules.gamjeom.lastSecondsWindowMs

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
