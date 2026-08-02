import { useCallback, useEffect, useRef, useState } from 'react'

interface LongPressButtonProps {
  label: string
  onComplete: () => void
  disabled?: boolean
  holdMs?: number
  className?: string
  ariaLabel?: string
}

/**
 * 長按才會執行的按鈕，用於「結束本回合」這類不可誤觸的操作。
 *
 * - 按住期間以進度條顯示剩餘時間
 * - 中途放開或移出按鈕範圍立即取消
 * - 鍵盤使用者按住 Enter／空白鍵同樣有效
 */
export function LongPressButton({
  label,
  onComplete,
  disabled = false,
  holdMs = 900,
  className = '',
  ariaLabel,
}: LongPressButtonProps): React.ReactElement {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)

  const cancel = useCallback(() => {
    startedAtRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setProgress(0)
  }, [])

  const start = useCallback(() => {
    if (disabled || startedAtRef.current !== null) return
    const startedAt = Date.now()
    startedAtRef.current = startedAt

    // 具名函式宣告可安全遞迴呼叫自己來驅動動畫
    function loop(): void {
      if (startedAtRef.current === null) return
      const ratio = Math.min(1, (Date.now() - startedAt) / holdMs)
      setProgress(ratio)
      if (ratio >= 1) {
        cancel()
        onComplete()
        return
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
  }, [cancel, disabled, holdMs, onComplete])

  useEffect(() => cancel, [cancel])

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') start()
      }}
      onKeyUp={cancel}
      onBlur={cancel}
      className={[
        'relative min-h-[56px] overflow-hidden rounded-lg border-2 border-line bg-panel-2 px-3 py-2',
        'text-[clamp(0.75rem,2vh,0.95rem)] font-bold text-slate-100',
        'focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-35',
        className,
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-amber-500/45"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative">{label}</span>
    </button>
  )
}
