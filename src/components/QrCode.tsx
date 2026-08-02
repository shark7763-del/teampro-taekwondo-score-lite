import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface QrCodeProps {
  value: string
  label: string
  size?: number
}

/**
 * QR Code。使用打包進來的 qrcode 套件產生 data URL，
 * 不依賴任何外部服務，離線也能顯示。
 */
export function QrCode({ value, label, size = 160 }: QrCodeProps): React.ReactElement {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: '#05070c', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch((error: unknown) => {
        console.warn('[qr] 產生失敗', error)
      })
    return () => {
      cancelled = true
    }
  }, [value, size])

  return (
    <figure className="flex flex-col items-center gap-2 rounded-xl border border-line bg-panel p-3">
      <figcaption className="text-sm font-bold text-slate-200">{label}</figcaption>
      {dataUrl === null ? (
        <div
          className="animate-pulse rounded bg-slate-700"
          style={{ width: size, height: size }}
          aria-hidden="true"
        />
      ) : (
        <img src={dataUrl} alt={`${label} QR Code`} width={size} height={size} className="rounded" />
      )}
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(value)}
        className="min-h-[44px] w-full rounded-lg border border-line bg-panel-2 px-2 text-xs font-bold text-slate-300 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        複製連結
      </button>
    </figure>
  )
}
