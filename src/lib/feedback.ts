/**
 * 震動與音效。全部可由設定關閉，且失敗時絕不影響計分流程。
 */

export type VibrationPattern = 'press' | 'confirmed' | 'rejected' | 'roundEnd'

const PATTERNS: Record<VibrationPattern, number | number[]> = {
  press: 15,
  confirmed: [30, 40, 60],
  rejected: [10, 60, 10],
  roundEnd: [120, 80, 120],
}

export function vibrate(pattern: VibrationPattern, enabled: boolean): void {
  if (!enabled) return
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(PATTERNS[pattern])
    }
  } catch {
    /* 部分瀏覽器不支援，忽略 */
  }
}

let audioContext: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor === undefined) return null
    audioContext ??= new Ctor()
    if (audioContext.state === 'suspended') void audioContext.resume()
    return audioContext
  } catch {
    return null
  }
}

export type BeepKind = 'score' | 'roundEnd' | 'matchEnd' | 'warning'

const BEEPS: Record<BeepKind, { freq: number; durationMs: number; repeat: number }> = {
  score: { freq: 880, durationMs: 90, repeat: 1 },
  roundEnd: { freq: 660, durationMs: 350, repeat: 2 },
  matchEnd: { freq: 520, durationMs: 500, repeat: 3 },
  warning: { freq: 1_040, durationMs: 120, repeat: 1 },
}

/** 以 WebAudio 產生提示音，不需要外部音檔，離線可用 */
export function beep(kind: BeepKind, enabled: boolean): void {
  if (!enabled) return
  const ctx = getContext()
  if (ctx === null) return
  const { freq, durationMs, repeat } = BEEPS[kind]
  for (let i = 0; i < repeat; i += 1) {
    const startAt = ctx.currentTime + (i * (durationMs + 90)) / 1000
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start(startAt)
      osc.stop(startAt + durationMs / 1000 + 0.02)
    } catch {
      return
    }
  }
}

/** 使用者第一次互動時解鎖音訊（瀏覽器自動播放限制） */
export function unlockAudio(): void {
  getContext()
}
