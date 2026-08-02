import type { ActionType, AthleteSide, MatchEvent, MatchState } from '../types'
import { SideControls } from './ScoreButtons'
import { LongPressButton } from './LongPressButton'
import { ActionButton } from './ui'
import { describeEvent, shortDescribeEvent } from '../rules/ruleEngine'

export interface ControlPanelProps {
  state: MatchState
  /** 是否已進入該回合最後 10 秒（由呼叫端依伺服器／本機時間計算） */
  inLastSeconds: boolean
  correctionMode: boolean
  undoTarget: MatchEvent | null
  onScore: (side: AthleteSide, action: ActionType) => boolean
  onGamjeom: (side: AthleteSide) => void
  onSpecialGamjeom: (side: AthleteSide) => void
  onToggleTimer: () => void
  onUndo: () => void
  onToggleCorrection: () => void
  onEndRound: () => void
  onOpenMenu: () => void
}

/**
 * 控制端（Controller）UI。
 *
 * 與 Scoreboard（顯示端）完全分離：本元件只負責「操作」，
 * 不含任何比分顯示邏輯，未來手機當控制器、電視當顯示器時可直接沿用。
 *
 * 版型：
 * - 手機橫向／平板／桌機：左藍｜中控制｜右紅（三欄）
 * - 手機直向：中控制在上方橫跨整列，下方左藍右紅兩欄
 * 皆使用 CSS Grid，不使用固定 pixel 定位。
 */
export function ControlPanel({
  state,
  inLastSeconds,
  correctionMode,
  undoTarget,
  onScore,
  onGamjeom,
  onSpecialGamjeom,
  onToggleTimer,
  onUndo,
  onToggleCorrection,
  onEndRound,
  onOpenMenu,
}: ControlPanelProps): React.ReactElement {
  const scoringDisabled = state.matchStatus === 'FINISHED'
  const running = state.timer.timerStatus === 'RUNNING'
  const canEndRound = state.matchStatus === 'RUNNING' || state.matchStatus === 'PAUSED'

  return (
    <section
      aria-label="計分操作區"
      className={[
        'grid min-h-0 gap-1 border-t-2 p-1 transition-colors',
        correctionMode ? 'border-amber-400 bg-amber-950/40' : 'border-line bg-panel',
        'portrait:grid-cols-2 portrait:grid-rows-[auto_minmax(0,1fr)]',
        'landscape:grid-cols-[minmax(0,1fr)_minmax(9rem,20%)_minmax(0,1fr)]',
      ].join(' ')}
    >
      <div className="min-h-0 portrait:order-2">
        <SideControls
          side="BLUE"
          ruleSetCode={state.config.ruleSetCode}
          disabled={scoringDisabled}
          correctionMode={correctionMode}
          onPress={onScore}
          onGamjeom={onGamjeom}
          onSpecialGamjeom={onSpecialGamjeom}
          specialGamjeomEnabled={inLastSeconds}
        />
      </div>

      <div className="flex min-h-0 flex-col gap-1 portrait:order-1 portrait:col-span-2">
        {correctionMode ? (
          <div
            role="status"
            className="flex min-h-[56px] items-center justify-center rounded-lg border-2 border-amber-400 bg-amber-500/20 px-2 text-center text-[clamp(0.7rem,1.9vh,0.95rem)] font-bold text-amber-200"
          >
            修正模式：請選擇要扣除的分數
          </div>
        ) : (
          <ActionButton
            tone={running ? 'warning' : 'primary'}
            className="min-h-[56px]"
            disabled={state.matchStatus === 'FINISHED'}
            onClick={onToggleTimer}
          >
            {running ? '暫停' : state.matchStatus === 'READY' ? '開始' : '繼續'}
          </ActionButton>
        )}

        <ActionButton
          tone="neutral"
          className="min-h-[56px] text-[clamp(0.7rem,1.9vh,0.95rem)]"
          disabled={undoTarget === null}
          ariaLabel={undoTarget === null ? '沒有可復原的紀錄' : `復原 ${describeEvent(undoTarget)}`}
          onClick={onUndo}
        >
          {undoTarget === null ? '無可復原' : `復原：${shortDescribeEvent(undoTarget)}`}
        </ActionButton>

        <div className="grid grid-cols-2 gap-1">
          <ActionButton
            tone={correctionMode ? 'warning' : 'neutral'}
            className="min-h-[56px] text-[clamp(0.65rem,1.7vh,0.85rem)]"
            onClick={onToggleCorrection}
          >
            {correctionMode ? '取消修正' : '扣分修正'}
          </ActionButton>
          <ActionButton
            tone="ghost"
            className="min-h-[56px] text-[clamp(0.65rem,1.7vh,0.85rem)]"
            onClick={onOpenMenu}
          >
            選單
          </ActionButton>
        </div>

        <LongPressButton
          label="長按結束本回合"
          holdMs={900}
          disabled={!canEndRound}
          onComplete={onEndRound}
        />
      </div>

      <div className="min-h-0 portrait:order-3">
        <SideControls
          side="RED"
          ruleSetCode={state.config.ruleSetCode}
          disabled={scoringDisabled}
          correctionMode={correctionMode}
          onPress={onScore}
          onGamjeom={onGamjeom}
          onSpecialGamjeom={onSpecialGamjeom}
          specialGamjeomEnabled={inLastSeconds}
        />
      </div>
    </section>
  )
}
