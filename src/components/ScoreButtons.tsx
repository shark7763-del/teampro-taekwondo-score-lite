import { useCallback, useRef, useState } from 'react'
import type { ActionType, AthleteSide } from '../types'
import { listActions } from '../rules/ruleEngine'
import { getRuleSet } from '../rules/ruleSets'

interface ScoreButtonsProps {
  side: AthleteSide
  ruleSetCode: string
  disabled: boolean
  /** 修正模式：按下代表扣除該技術的分數 */
  correctionMode?: boolean
  /**
   * 回傳 true 代表這次按鍵已被受理（單機模式已計分／裁判模式已送出伺服器），
   * 只有被受理的按鍵才會進入防誤觸冷卻；被拒絕的按鍵不應鎖住下一次正常操作。
   */
  onPress: (side: AthleteSide, action: ActionType) => boolean
  /** 上一次送出的技術（用於顯示等待中狀態，裁判端使用） */
  pendingAction?: ActionType | null
}

/**
 * 五顆計分按鈕。
 * - 最小觸控高度 56px（橫向時自動變大）
 * - 同一技術有短暫冷卻，避免手指抖動造成連按
 * - 按下立即有視覺回饋，但不代表分數已成立（雙裁判模式由伺服器決定）
 */
export function ScoreButtons({
  side,
  ruleSetCode,
  disabled,
  correctionMode = false,
  onPress,
  pendingAction = null,
}: ScoreButtonsProps): React.ReactElement {
  const actions = listActions(ruleSetCode)
  const cooldownMs = getRuleSet(ruleSetCode).trainingDefaults.pressCooldownMs
  const lastPressRef = useRef<Record<string, number>>({})
  const [glowing, setGlowing] = useState<ActionType | null>(null)

  const isBlue = side === 'BLUE'
  const base = isBlue
    ? 'bg-blue-side/90 active:bg-blue-side border-blue-300/40'
    : 'bg-red-side/90 active:bg-red-side border-red-300/40'
  const correction = 'bg-slate-700 active:bg-slate-600 border-amber-400/60'

  const handlePress = useCallback(
    (action: ActionType) => {
      if (disabled) return
      const now = Date.now()
      const key = `${side}-${action}`
      const last = lastPressRef.current[key] ?? 0
      if (now - last < cooldownMs) return
      setGlowing(action)
      window.setTimeout(() => setGlowing(null), 450)
      const accepted = onPress(side, action)
      if (accepted) lastPressRef.current[key] = now
    },
    [disabled, side, cooldownMs, onPress],
  )

  return (
    <div className="grid grid-cols-5 gap-1 sm:gap-2">
      {actions.map(({ action, points, label, shortLabel }) => (
        <button
          key={action}
          type="button"
          disabled={disabled}
          onPointerDown={() => handlePress(action)}
          aria-label={`${isBlue ? '藍方' : '紅方'} ${label} ${correctionMode ? '扣' : '加'} ${points} 分`}
          className={[
            'flex min-h-[56px] flex-col items-center justify-center rounded-lg border-2 px-1 py-2',
            'font-bold text-white transition-transform landscape:min-h-[72px]',
            'disabled:cursor-not-allowed disabled:opacity-35',
            correctionMode ? correction : base,
            glowing === action ? 'animate-press-glow scale-[0.97]' : '',
            pendingAction === action ? 'ring-4 ring-amber-300' : '',
          ].join(' ')}
        >
          <span className="text-[clamp(1.4rem,3.5vh,2.4rem)] leading-none tabular">
            {correctionMode ? '−' : '+'}
            {points}
          </span>
          <span className="mt-1 text-[clamp(0.6rem,1.6vh,0.85rem)] font-medium opacity-90">
            {shortLabel}
          </span>
        </button>
      ))}
    </div>
  )
}
