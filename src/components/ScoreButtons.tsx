import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionType, AthleteSide } from '../types'
import { listActions, opponentOf, sideLabel } from '../rules/ruleEngine'
import { getRuleSet } from '../rules/ruleSets'

export interface SideControlsProps {
  side: AthleteSide
  ruleSetCode: string
  disabled: boolean
  /** 單次修正模式：按下代表扣除該技術的分數 */
  correctionMode?: boolean
  /** 回傳 true 代表本次按鍵已被受理，只有被受理的按鍵才進入防誤觸冷卻 */
  onPress: (side: AthleteSide, action: ActionType) => boolean
  /** 一般 Gam-jeom（對手 +1） */
  onGamjeom: (side: AthleteSide) => void
  /** 最後 10 秒消極 Gam-jeom（對手 +2） */
  onSpecialGamjeom: (side: AthleteSide) => void
  /** 是否已進入最後 10 秒（按鈕位置永遠保留，只切換 enabled） */
  specialGamjeomEnabled: boolean
  /** 裁判端等待另一位裁判確認時使用 */
  pendingAction?: ActionType | null
  /** 裁判端只負責技術得分，Gam-jeom 由主控端處理 */
  hideGamjeom?: boolean
}

/**
 * 單一方（藍或紅）的完整操作區。
 *
 * 固定 2×3 配置，藍紅完全一致，讓教練建立肌肉記憶：
 *
 *   ┌──────────┬──────────┐
 *   │ +2 身體  │ +3 頭部  │  ← 最常用，面積最大
 *   ├──────────┼──────────┤
 *   │ +1 正拳  │ +4 旋身  │
 *   ├──────────┼──────────┤
 *   │ +6 旋頭  │ GJ 違規  │
 *   └──────────┴──────────┘
 *   │   最後10秒消極（固定位置，未達條件為 disabled）  │
 *
 * ⚠️ 任何狀態變化都不得增減按鈕數量或改變高度，避免比賽中版面位移。
 */
export function SideControls({
  side,
  ruleSetCode,
  disabled,
  correctionMode = false,
  onPress,
  onGamjeom,
  onSpecialGamjeom,
  specialGamjeomEnabled,
  pendingAction = null,
  hideGamjeom = false,
}: SideControlsProps): React.ReactElement {
  const actions = listActions(ruleSetCode)
  const rules = getRuleSet(ruleSetCode)
  const cooldownMs = rules.trainingDefaults.pressCooldownMs
  const lastPressRef = useRef<Record<string, number>>({})
  const [glowing, setGlowing] = useState<string | null>(null)

  // 切換修正模式代表全新的操作意圖，先清掉冷卻紀錄，
  // 避免剛加完分馬上要扣分時被防誤觸機制擋掉。
  useEffect(() => {
    lastPressRef.current = {}
  }, [correctionMode])

  const isBlue = side === 'BLUE'
  const me = sideLabel(side)
  const foe = sideLabel(opponentOf(side))

  const flash = useCallback((key: string) => {
    setGlowing(key)
    window.setTimeout(() => setGlowing((current) => (current === key ? null : current)), 420)
  }, [])

  const handleScore = useCallback(
    (action: ActionType) => {
      if (disabled) return
      const now = Date.now()
      const key = `${side}-${action}`
      const last = lastPressRef.current[key] ?? 0
      // 冷卻只擋同一顆按鈕的手指抖動，不同技術之間完全不受限制
      if (now - last < cooldownMs) return
      flash(key)
      const accepted = onPress(side, action)
      if (accepted) lastPressRef.current[key] = now
    },
    [disabled, side, cooldownMs, flash, onPress],
  )

  /** 依配置順序取得技術：身體、頭部、正拳、旋身、旋頭 */
  const byAction = (action: ActionType): { points: number; label: string; shortLabel: string } => {
    const found = actions.find((a) => a.action === action)
    return found ?? { points: 0, label: action, shortLabel: action }
  }

  const scoreCell = (action: ActionType, emphasis: boolean): React.ReactElement => {
    const { points, label, shortLabel } = byAction(action)
    const key = `${side}-${action}`
    return (
      <button
        key={action}
        type="button"
        disabled={disabled}
        onPointerDown={() => handleScore(action)}
        aria-label={`${me} ${label} ${correctionMode ? '扣除' : '得'} ${points} 分`}
        className={[
          'flex min-h-[64px] flex-col items-center justify-center rounded-lg border-2 px-1',
          'font-bold text-white select-none',
          'focus-visible:ring-4 focus-visible:ring-white/70 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-35',
          correctionMode
            ? 'border-amber-400/70 bg-slate-700 active:bg-slate-600'
            : isBlue
              ? 'border-blue-200/35 bg-blue-side active:bg-blue-side-dark'
              : 'border-red-200/35 bg-red-side active:bg-red-side-dark',
          glowing === key ? 'animate-press-glow' : '',
          pendingAction === action ? 'ring-4 ring-amber-300' : '',
        ].join(' ')}
      >
        <span
          className={`tabular leading-none ${
            emphasis ? 'text-[clamp(1.7rem,5.5vh,3.2rem)]' : 'text-[clamp(1.3rem,4vh,2.4rem)]'
          }`}
        >
          {correctionMode ? '−' : '+'}
          {points}
        </span>
        <span className="mt-0.5 text-[clamp(0.6rem,1.5vh,0.85rem)] font-medium opacity-90">
          {shortLabel}
        </span>
      </button>
    )
  }

  const gamjeomKey = `${side}-GJ`

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      {/* 2×3 主操作區；第一列（身體／頭部）面積最大 */}
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[1.3fr_1fr_1fr] gap-1">
        {scoreCell('BODY_KICK', true)}
        {scoreCell('HEAD_KICK', true)}
        {scoreCell('BODY_PUNCH', false)}
        {scoreCell('TURNING_BODY_KICK', false)}
        {scoreCell('TURNING_HEAD_KICK', false)}

        {hideGamjeom ? (
          <div aria-hidden="true" />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onPointerDown={() => {
              if (disabled) return
              const now = Date.now()
              const last = lastPressRef.current[gamjeomKey] ?? 0
              if (now - last < cooldownMs) return
              lastPressRef.current[gamjeomKey] = now
              flash(gamjeomKey)
              onGamjeom(side)
            }}
            aria-label={`${me}違規，${foe}加 ${rules.gamjeom.normalOpponentPoints} 分`}
            className={[
              'flex min-h-[64px] flex-col items-center justify-center rounded-lg border-2 px-1',
              'border-amber-300/60 bg-amber-600 font-bold text-black select-none',
              'focus-visible:ring-4 focus-visible:ring-white/70 focus-visible:outline-none',
              'active:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-35',
              glowing === gamjeomKey ? 'animate-press-glow' : '',
            ].join(' ')}
          >
            <span className="text-[clamp(1.1rem,3.2vh,1.9rem)] leading-none">GJ</span>
            <span className="mt-0.5 text-[clamp(0.6rem,1.5vh,0.8rem)] font-bold">
              {me}違規 {foe}+{rules.gamjeom.normalOpponentPoints}
            </span>
          </button>
        )}
      </div>

      {/*
        最後 10 秒消極違規：位置從比賽一開始就固定保留，
        未進入最後 10 秒時為 disabled，不會突然出現造成版面位移。
      */}
      {!hideGamjeom && (
        <button
          type="button"
          disabled={disabled || !specialGamjeomEnabled}
          onPointerDown={() => {
            if (disabled || !specialGamjeomEnabled) return
            onSpecialGamjeom(side)
          }}
          aria-label={`${me}最後 10 秒消極違規，${foe}加 ${rules.gamjeom.lastSecondsOpponentPoints} 分`}
          aria-disabled={!specialGamjeomEnabled}
          className={[
            'min-h-[56px] shrink-0 rounded-lg border-2 px-2 py-1 text-[clamp(0.6rem,1.7vh,0.85rem)] font-bold select-none',
            'focus-visible:ring-4 focus-visible:ring-white/70 focus-visible:outline-none',
            specialGamjeomEnabled
              ? 'border-rose-300/60 bg-rose-700 text-white active:bg-rose-600'
              : 'border-line bg-panel-2 text-slate-500',
          ].join(' ')}
        >
          最後10秒消極 {foe}+{rules.gamjeom.lastSecondsOpponentPoints}
        </button>
      )}
    </div>
  )
}
