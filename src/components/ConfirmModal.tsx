import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ConfirmModalProps {
  title: string
  description: ReactNode
  /** 危險動作的按鈕文字 */
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 危險操作確認對話框。
 *
 * 取代 window.confirm：樣式一致、可鍵盤操作、
 * 並刻意把「取消」放在慣用手容易按到的右側、危險動作放左側，
 * 避免快速連點時直接落在危險按鈕上。
 */
export function ConfirmModal({
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: ConfirmModalProps): React.ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border-2 border-rose-500/50 bg-panel p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-black text-rose-300">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-slate-300">{description}</div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[56px] rounded-lg border-2 border-rose-400/50 bg-rose-700 px-3 font-bold text-white focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-[56px] rounded-lg border-2 border-line bg-panel-2 px-3 font-bold text-slate-100 focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
