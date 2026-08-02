import type { AthleteSide, MatchState } from '../types'
import { formatClock } from '../timer/timer'
import { getRuleSet } from '../rules/ruleSets'
import type { FlashEvent } from '../hooks/useSoloMatch'
import { opponentOf, roundWinsNeeded } from '../rules/ruleEngine'

interface ScoreboardProps {
  state: MatchState
  remainingMs: number
  flash: FlashEvent | null
  /** 電視端會顯示連線狀態列 */
  statusSlot?: React.ReactNode
  compact?: boolean
  /** 提供時，時間區變成可點擊的開始／暫停按鈕（控制端使用；顯示端不傳） */
  onToggleTimer?: () => void
}

const STATUS_LABEL: Record<MatchState['matchStatus'], string> = {
  READY: '尚未開始',
  RUNNING: '比賽進行中',
  PAUSED: '已暫停',
  REST: '休息中',
  FINISHED: '比賽結束',
}

/**
 * 大型計分板。單機鏡射模式與電視顯示端共用同一個元件，
 * 確保兩種情境的數字、版位與字級完全一致。
 *
 * 版位規則：藍方永遠在左、紅方永遠在右，任何情況都不交換。
 */
export function Scoreboard({
  state,
  remainingMs,
  flash,
  statusSlot,
  compact = false,
  onToggleTimer,
}: ScoreboardProps): React.ReactElement {
  const { config, scores, currentRound, matchStatus } = state
  const rules = getRuleSet(config.ruleSetCode)
  const winsNeeded = roundWinsNeeded(config.totalRounds, config.ruleSetCode)
  const isLast10Window = remainingMs > 0 && remainingMs <= rules.gamjeom.lastSecondsWindowMs
  const timeToneClass =
    isLast10Window && matchStatus === 'RUNNING'
      ? 'text-amber-300'
      : matchStatus === 'PAUSED'
        ? 'text-slate-400'
        : 'text-white'
  const timeSizeClass = compact ? 'text-[clamp(2.5rem,11vh,6rem)]' : 'text-[clamp(3rem,18vh,12rem)]'
  const scoreSize = compact ? 'text-[clamp(3.5rem,16vh,9rem)]' : 'text-[clamp(5rem,30vh,20rem)]'
  const nameSize = compact ? 'text-[clamp(1rem,3.5vh,1.6rem)]' : 'text-[clamp(1.2rem,5vh,3rem)]'

  return (
    <div className="flex h-full w-full flex-col bg-ink">
      <div className="grid flex-1 grid-cols-[1fr_minmax(22%,26%)_1fr] overflow-hidden">
        <SidePanel
          side="BLUE"
          name={config.blueName}
          score={scores.blueScore}
          gamjeom={scores.blueGamjeom}
          roundWins={state.roundWins.blue}
          winsNeeded={winsNeeded}
          isWinner={state.matchWinner === 'BLUE'}
          flash={flash}
          scoreSize={scoreSize}
          nameSize={nameSize}
        />

        <div className="flex flex-col items-center justify-center gap-[1vh] border-x-2 border-line bg-panel px-2">
          <div className="text-center text-[clamp(0.7rem,2.2vh,1.2rem)] font-semibold tracking-widest text-slate-400">
            第 {currentRound} 回合
            <span className="ml-1 text-slate-500">（{winsNeeded} 勝制）</span>
          </div>
          {onToggleTimer === undefined ? (
            <div
              className={`tabular font-black leading-none ${timeToneClass} ${timeSizeClass}`}
              aria-label="剩餘時間"
            >
              {formatClock(remainingMs)}
            </div>
          ) : (
            <button
              type="button"
              onClick={onToggleTimer}
              disabled={matchStatus === 'FINISHED'}
              aria-label={`剩餘時間 ${formatClock(remainingMs)}，點擊${
                matchStatus === 'RUNNING' ? '暫停' : '開始'
              }計時`}
              className={[
                'tabular w-full rounded-lg font-black leading-none select-none',
                'focus-visible:ring-4 focus-visible:ring-white/70 focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-60',
                timeToneClass,
                timeSizeClass,
              ].join(' ')}
            >
              {formatClock(remainingMs)}
            </button>
          )}
          <div
            className={`rounded-full px-[2vh] py-[0.5vh] text-[clamp(0.7rem,2.4vh,1.3rem)] font-bold ${
              matchStatus === 'RUNNING'
                ? 'bg-emerald-500/20 text-emerald-300'
                : matchStatus === 'FINISHED'
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'bg-slate-500/20 text-slate-300'
            }`}
          >
            {STATUS_LABEL[matchStatus]}
          </div>
          {statusSlot}
        </div>

        <SidePanel
          side="RED"
          name={config.redName}
          score={scores.redScore}
          gamjeom={scores.redGamjeom}
          roundWins={state.roundWins.red}
          winsNeeded={winsNeeded}
          isWinner={state.matchWinner === 'RED'}
          flash={flash}
          scoreSize={scoreSize}
          nameSize={nameSize}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-panel px-3 py-1 text-[clamp(0.55rem,1.6vh,0.9rem)] text-slate-400">
        <span>
          規則版本 {rules.effectiveDate}
          {rules.officialSourceVerified ? '' : '（待官方核對）'}
        </span>
        <span className="truncate">本系統供訓練賽及模擬賽使用，非 WT 認證競賽設備</span>
      </div>
    </div>
  )
}

interface SidePanelProps {
  side: AthleteSide
  name: string
  score: number
  gamjeom: number
  roundWins: number
  winsNeeded: number
  isWinner: boolean
  flash: FlashEvent | null
  scoreSize: string
  nameSize: string
}

function SidePanel({
  side,
  name,
  score,
  gamjeom,
  roundWins,
  winsNeeded,
  isWinner,
  flash,
  scoreSize,
  nameSize,
}: SidePanelProps): React.ReactElement {
  const isBlue = side === 'BLUE'
  const bg = isBlue
    ? 'bg-gradient-to-b from-blue-side to-blue-side-dark'
    : 'bg-gradient-to-b from-red-side to-red-side-dark'

  const flashDelta = flashPointsFor(flash, side)

  return (
    <section className={`relative flex flex-col items-center justify-center ${bg}`}>
      <h2
        className={`absolute top-[2vh] max-w-[92%] truncate px-2 font-bold text-white/90 ${nameSize}`}
      >
        {name}
        {isWinner && <span className="ml-2 text-amber-300">勝</span>}
      </h2>

      {/* 三回合兩勝制：已贏得的回合數 */}
      <div
        className="absolute top-[9vh] flex gap-[0.8vh]"
        aria-label={`${isBlue ? '藍方' : '紅方'}已勝回合數 ${roundWins}`}
      >
        {Array.from({ length: winsNeeded }, (_, i) => (
          <span
            key={i}
            className={`inline-block rounded-full border-2 ${
              i < roundWins ? 'border-amber-300 bg-amber-300' : 'border-white/40 bg-transparent'
            }`}
            style={{ width: 'clamp(0.7rem,2.2vh,1.6rem)', height: 'clamp(0.7rem,2.2vh,1.6rem)' }}
          />
        ))}
      </div>

      <div
        className={`tabular font-black leading-none text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.45)] ${scoreSize}`}
        aria-label={`${isBlue ? '藍方' : '紅方'}分數`}
      >
        {score}
      </div>

      {flashDelta !== null && (
        <div
          key={flash?.key}
          className="animate-score-pop pointer-events-none absolute top-[14%] text-[clamp(2rem,9vh,6rem)] font-black text-white"
        >
          +{flashDelta}
        </div>
      )}

      <div className="absolute bottom-[2vh] flex items-center gap-2 text-[clamp(0.7rem,2.4vh,1.4rem)] font-bold text-white/85">
        <span>Gam-jeom</span>
        <span className="tabular rounded bg-black/30 px-2">{gamjeom}</span>
      </div>
    </section>
  )
}

/** 計算該側這次應該浮出的加分數字（Gam-jeom 會加在對手身上） */
function flashPointsFor(flash: FlashEvent | null, side: AthleteSide): number | null {
  if (flash === null) return null
  const { event } = flash
  if (event.pointsDelta <= 0) return null
  if (event.type === 'GAMJEOM') {
    return opponentOf(event.athleteSide) === side ? event.pointsDelta : null
  }
  if (event.type === 'SCORE' || event.type === 'MANUAL_ADJUSTMENT') {
    return event.athleteSide === side ? event.pointsDelta : null
  }
  return null
}
