import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { NonCertifiedNotice, Panel } from '../components/ui'
import { loadSoloMatch } from '../storage/soloStorage'
import { getRuleSet } from '../rules/ruleSets'
import { formatClock } from '../timer/timer'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

export function HomePage(): React.ReactElement {
  const rules = getRuleSet()
  // 讀取上一場單機比賽：在初始化時同步讀 localStorage，不需要 effect
  const [recent] = useState<ReturnType<typeof loadSoloMatch>>(() => loadSoloMatch())
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const handler = (event: Event): void => {
      event.preventDefault()
      setInstallEvent(event as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  return (
    <div className="safe-area mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 p-4">
      <header className="pt-4">
        <p className="text-sm font-bold tracking-[0.2em] text-emerald-400">TEAMPRO</p>
        <h1 className="text-3xl font-black tracking-tight">跆拳道簡易計分系統</h1>
        <p className="mt-1 text-sm text-slate-400">
          Taekwondo Score Lite · 規則版本 {rules.effectiveDate}
          {rules.officialSourceVerified ? '' : '（待官方核對）'}
        </p>
      </header>

      <NonCertifiedNotice />

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/solo"
          className="flex min-h-[104px] flex-col justify-center rounded-xl border-2 border-emerald-500/50 bg-emerald-600/15 p-4 transition-colors hover:bg-emerald-600/25"
        >
          <span className="text-xl font-black">單手機計分</span>
          <span className="mt-1 text-sm text-slate-300">
            一台手機立即開始，可鏡射到電視，離線可用
          </span>
        </Link>

        <Link
          to="/create"
          className="flex min-h-[104px] flex-col justify-center rounded-xl border-2 border-line bg-panel p-4 transition-colors hover:bg-panel-2"
        >
          <span className="text-xl font-black">建立多人比賽</span>
          <span className="mt-1 text-sm text-slate-300">
            電視顯示端＋主控端＋裁判 A／B（第二階段）
          </span>
        </Link>

        <Link
          to="/join"
          className="flex min-h-[76px] flex-col justify-center rounded-xl border border-line bg-panel p-4 hover:bg-panel-2"
        >
          <span className="text-lg font-bold">加入比賽</span>
          <span className="text-sm text-slate-400">輸入六碼房間代碼</span>
        </Link>

        {recent !== null ? (
          <Link
            to="/solo"
            className="flex min-h-[76px] flex-col justify-center rounded-xl border border-line bg-panel p-4 hover:bg-panel-2"
          >
            <span className="text-lg font-bold">繼續上一場單機比賽</span>
            <span className="text-sm text-slate-400">
              {recent.state.config.blueName} {recent.state.scores.blueScore} :{' '}
              {recent.state.scores.redScore} {recent.state.config.redName} · 第{' '}
              {recent.state.currentRound} 回合 ·{' '}
              {formatClock(recent.state.timer.remainingMsAtStart, false)}
            </span>
          </Link>
        ) : (
          <div className="flex min-h-[76px] flex-col justify-center rounded-xl border border-dashed border-line p-4 text-sm text-slate-500">
            尚無最近一次單機比賽
          </div>
        )}
      </div>

      {installEvent !== null && (
        <button
          type="button"
          onClick={() => {
            void installEvent.prompt()
            setInstallEvent(null)
          }}
          className="min-h-[56px] rounded-xl border-2 border-emerald-500/50 bg-emerald-600/20 font-bold"
        >
          安裝到手機主畫面（PWA）
        </button>
      )}

      <Panel title="系統使用說明">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-slate-300">
          <li>
            <b>一台手機</b>：點「單手機計分」即可開始，將手機以 HDMI／AirPlay
            投到電視後，開啟「鏡射模式」隱藏操作面板。
          </li>
          <li>
            <b>手機＋電視獨立顯示</b>：建立多人比賽，電視掃描顯示端 QR Code，手機留在主控端。
          </li>
          <li>
            <b>兩台裁判手機</b>：裁判 A 與 B 分別掃描各自的 QR Code，兩人在確認時間窗內按下
            <b>相同選手、相同技術</b>才會正式加分一次。
          </li>
        </ol>
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          <b>三回合兩勝制</b>：每一回合分數<b>歸零重新計算</b>，先贏得 2 個回合者獲勝， 因此 2:0
          領先時<b>不會進行第三回合</b>。 回合平手時依序比較：旋轉技術得分 → 高分值技術數量 →
          仍相同則
          <b>直接由你依優勢判定</b>。 單一回合累積 {rules.round.gamjeomLimitPerRound} 次 Gam-jeom
          或分差達 {rules.round.pointGapThreshold} 分時，該回合提前結束。
        </p>
        <p className="mt-2 rounded-lg bg-panel-2 p-3 text-xs text-slate-400">
          分值依 {rules.name}：正拳 {rules.basePoints.BODY_PUNCH}、身體踢擊{' '}
          {rules.basePoints.BODY_KICK}、頭部踢擊 {rules.basePoints.HEAD_KICK}、旋轉技術為基本分 ×
          {rules.turningMultiplier}（旋身 {rules.basePoints.BODY_KICK * rules.turningMultiplier}
          、旋頭 {rules.basePoints.HEAD_KICK * rules.turningMultiplier}）。一般 Gam-jeom 對手 +
          {rules.gamjeom.normalOpponentPoints}；回合最後 10 秒消極行為之 Gam-jeom 對手 +
          {rules.gamjeom.lastSecondsOpponentPoints}，且只記 1 次 Gam-jeom。
          <br />
          <b>
            雙裁判確認時間窗（預設 {rules.trainingDefaults.confirmationWindowMs}{' '}
            毫秒）為本系統的訓練操作參數，並非 World Taekwondo 規定的秒數。
          </b>
        </p>
      </Panel>

      <footer className="pb-6 text-center text-xs text-slate-600">
        TeamPro Taekwondo Score Lite · 訓練與模擬用途
      </footer>
    </div>
  )
}
