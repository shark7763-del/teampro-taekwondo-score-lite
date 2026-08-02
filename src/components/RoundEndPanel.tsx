import type { AthleteSide, MatchState } from '../types'
import { roundReasonLabel, roundWinsNeeded, sideLabel } from '../rules/ruleEngine'
import { formatClock } from '../timer/timer'
import { ActionButton } from './ui'

interface RoundEndPanelProps {
  state: MatchState
  restRemainingMs: number
  onStartRest: () => void
  onSkipRest: () => void
  onFixResult: () => void
  onRestart: () => void
  onDecideSuperiority: (winner: AthleteSide) => void
}

/**
 * 回合結束／休息／比賽結束時的引導面板。
 *
 * 設計原則：教練不需要猜「現在該按哪一顆」，
 * 因此每個狀態都只呈現該狀態下有意義的操作，且主要動作最大顆。
 * 比分不會在此時被清除，仍可看到本回合結果後再進入下一回合。
 */
export function RoundEndPanel({
  state,
  restRemainingMs,
  onStartRest,
  onSkipRest,
  onFixResult,
  onRestart,
  onDecideSuperiority,
}: RoundEndPanelProps): React.ReactElement | null {
  const { matchStatus, roundResults, config, pendingSuperiorityRound } = state
  const lastResult = roundResults.at(-1) ?? null
  const winsNeeded = roundWinsNeeded(config.totalRounds, config.ruleSetCode)

  /* 平手：必須由教練判定，優先於其他狀態 */
  if (pendingSuperiorityRound !== null) {
    return (
      <Overlay>
        <h2 className="text-xl font-black text-amber-300">第 {pendingSuperiorityRound} 回合平手</h2>
        <p className="mt-2 text-sm text-slate-300">
          分數、旋轉技術得分與各分值技術數量皆相同，請依優勢判定本回合勝方。
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-panel-2 p-2 text-xs">
          <dt className="text-left text-slate-500">參考</dt>
          <dd className="font-bold text-blue-300">{config.blueName}</dd>
          <dd className="font-bold text-red-300">{config.redName}</dd>
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
            onClick={() => onDecideSuperiority('BLUE')}
          >
            {config.blueName} 勝
          </ActionButton>
          <ActionButton
            tone="neutral"
            className="min-h-[64px] border-red-300/60 bg-red-side text-white"
            onClick={() => onDecideSuperiority('RED')}
          >
            {config.redName} 勝
          </ActionButton>
        </div>
      </Overlay>
    )
  }

  /* 比賽結束 */
  if (matchStatus === 'FINISHED') {
    return (
      <Overlay>
        <h2 className="text-2xl font-black text-amber-300">比賽結束</h2>
        <p className="mt-1 text-lg font-bold">
          {state.matchWinner === null
            ? '雙方平手'
            : `${state.matchWinner === 'BLUE' ? config.blueName : config.redName} 獲勝`}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          回合戰績 {state.roundWins.blue} : {state.roundWins.red}（{winsNeeded} 勝制）
        </p>
        <RoundList state={state} />
        <div className="mt-4 grid gap-2">
          <ActionButton tone="primary" className="min-h-[64px]" onClick={onRestart}>
            重新開賽
          </ActionButton>
          <ActionButton tone="ghost" onClick={onFixResult}>
            修正最後一回合結果
          </ActionButton>
        </div>
      </Overlay>
    )
  }

  /* 回合之間的休息 */
  if (matchStatus === 'REST' && lastResult !== null) {
    const winnerName = lastResult.winner === 'BLUE' ? config.blueName : config.redName
    return (
      <Overlay>
        <h2 className="text-xl font-black">第 {lastResult.round} 回合結束</h2>
        <p className="mt-2 text-3xl font-black tabular">
          <span className="text-blue-300">{lastResult.blueScore}</span>
          <span className="mx-2 text-slate-500">:</span>
          <span className="text-red-300">{lastResult.redScore}</span>
        </p>
        <p className="mt-1 text-base font-bold text-amber-300">
          {winnerName} 勝
          {lastResult.reason !== null && (
            <span className="ml-1 text-xs font-normal text-slate-400">
              （{roundReasonLabel(lastResult.reason)}）
            </span>
          )}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          回合戰績 {state.roundWins.blue} : {state.roundWins.red}
        </p>

        <div className="mt-4 grid gap-2">
          {state.timer.timerStatus === 'RUNNING' ? (
            <div className="rounded-lg border border-line bg-panel-2 p-3">
              <p className="text-xs text-slate-400">休息倒數</p>
              <p className="tabular text-3xl font-black">{formatClock(restRemainingMs)}</p>
            </div>
          ) : (
            <ActionButton tone="neutral" className="min-h-[64px]" onClick={onStartRest}>
              開始休息倒數（{Math.round(config.restDurationMs / 1000)} 秒）
            </ActionButton>
          )}
          <ActionButton tone="primary" className="min-h-[64px]" onClick={onSkipRest}>
            {state.timer.timerStatus === 'RUNNING' ? '跳過休息' : '直接進入'}第 {state.currentRound}{' '}
            回合
          </ActionButton>
          <ActionButton tone="ghost" onClick={onFixResult}>
            修正本回合結果
          </ActionButton>
        </div>
      </Overlay>
    )
  }

  return null
}

function Overlay({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="safe-area fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4">
      <div className="w-full max-w-md rounded-xl border-2 border-line bg-panel p-5 text-center">
        {children}
      </div>
    </div>
  )
}

function RoundList({ state }: { state: MatchState }): React.ReactElement {
  return (
    <ul className="mt-3 flex flex-col gap-1 rounded-lg bg-panel-2 p-2 text-xs text-slate-300">
      {state.roundResults.map((r) => (
        <li key={r.round} className="flex justify-between">
          <span>第 {r.round} 回合</span>
          <span className="tabular">
            {r.blueScore} : {r.redScore}
          </span>
          <span className="font-bold">{r.winner === null ? '—' : sideLabel(r.winner)}勝</span>
        </li>
      ))}
    </ul>
  )
}
