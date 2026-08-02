import type { ReactNode } from 'react'

type ButtonTone = 'primary' | 'neutral' | 'danger' | 'warning' | 'ghost'

const TONES: Record<ButtonTone, string> = {
  primary:
    'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white border-emerald-400/40',
  neutral: 'bg-panel-2 hover:bg-slate-700 active:bg-slate-800 text-slate-100 border-line',
  danger: 'bg-rose-700 hover:bg-rose-600 active:bg-rose-800 text-white border-rose-400/40',
  warning: 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-black border-amber-300/50',
  ghost: 'bg-transparent hover:bg-white/5 text-slate-300 border-line',
}

interface ActionButtonProps {
  children: ReactNode
  onClick: () => void
  tone?: ButtonTone
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

/** 一般操作按鈕：最小觸控高度 56px，符合體育館現場快速操作需求 */
export function ActionButton({
  children,
  onClick,
  tone = 'neutral',
  disabled = false,
  className = '',
  ariaLabel,
}: ActionButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={[
        'flex min-h-[56px] items-center justify-center gap-2 rounded-lg border-2 px-3 py-2',
        'text-[clamp(0.85rem,2.2vh,1.1rem)] font-bold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-35',
        TONES[tone],
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function Panel({
  title,
  children,
  className = '',
}: {
  title?: string
  children: ReactNode
  className?: string
}): React.ReactElement {
  return (
    <section className={`rounded-xl border border-line bg-panel p-4 ${className}`}>
      {title !== undefined && <h2 className="mb-3 text-base font-bold text-slate-200">{title}</h2>}
      {children}
    </section>
  )
}

/** 全系統統一的免責聲明，首頁、設定頁與電視端都必須顯示 */
export function NonCertifiedNotice({ className = '' }: { className?: string }): React.ReactElement {
  return (
    <p
      className={`rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ${className}`}
    >
      ⚠️ 本系統供訓練賽及模擬賽使用，非 WT 認證競賽設備。
    </p>
  )
}

export function Toast({
  message,
  tone = 'danger',
}: {
  message: string
  tone?: 'danger' | 'info'
}): React.ReactElement {
  return (
    <div
      role="status"
      className={[
        'pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg px-4 py-2',
        'text-sm font-bold shadow-lg',
        tone === 'danger' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-100',
      ].join(' ')}
    >
      {message}
    </div>
  )
}
