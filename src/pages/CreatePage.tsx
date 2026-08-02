import { useState } from 'react'
import { Link } from 'react-router'
import { ActionButton, NonCertifiedNotice, Panel } from '../components/ui'
import { QrCode } from '../components/QrCode'
import { createMatchState } from '../match/matchCore'
import { createRoomConfig, saveRoom } from '../room/roomStorage'
import type { RoomConfig } from '../room/roomTypes'
import { loadPreferences } from '../storage/preferences'
import { getRuleSet } from '../rules/ruleSets'
import type { JudgeMode } from '../types'

function generateHostPin(): string {
  const random = new Uint32Array(1)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(random)
    return String(1000 + ((random[0] ?? 0) % 9000))
  }
  return String(Math.floor(1000 + Math.random() * 9000))
}

/**
 * 建立多人比賽。
 *
 * 只露出三個必要欄位（藍方、紅方、裁判人數），其餘沿用上一次設定，
 * 讓教練能在 10 秒內開好房間。
 */
export function CreatePage(): React.ReactElement {
  const prefs = loadPreferences()
  const rules = getRuleSet(prefs.lastSetup.ruleSetCode)
  const [blueName, setBlueName] = useState(prefs.lastSetup.blueName)
  const [redName, setRedName] = useState(prefs.lastSetup.redName)
  const [judgeMode, setJudgeMode] = useState<JudgeMode>('DUAL')
  const [confirmationWindowMs, setConfirmationWindowMs] = useState(
    rules.trainingDefaults.confirmationWindowMs,
  )
  const [hostPin, setHostPin] = useState('')
  const [room, setRoom] = useState<RoomConfig | null>(null)

  const create = (): void => {
    const pin = hostPin.trim() === '' ? generateHostPin() : hostPin.trim()
    const config = createRoomConfig({ hostPin: pin, judgeMode, confirmationWindowMs })
    const match = createMatchState({
      blueName: blueName.trim() === '' ? '藍方' : blueName.trim(),
      redName: redName.trim() === '' ? '紅方' : redName.trim(),
      totalRounds: prefs.lastSetup.totalRounds,
      roundDurationMs: prefs.lastSetup.roundDurationMs,
      restDurationMs: prefs.lastSetup.restDurationMs,
      ruleSetCode: prefs.lastSetup.ruleSetCode,
      judgeMode,
      confirmationWindowMs,
      soundEnabled: prefs.soundEnabled,
      vibrationEnabled: prefs.vibrationEnabled,
    })
    saveRoom(config, match)
    setHostPin(pin)
    setRoom(config)
  }

  if (room !== null) {
    return <RoomCreated room={room} pin={hostPin} />
  }

  return (
    <div className="safe-area mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 p-4">
      <Link to="/" className="text-sm font-bold text-slate-400">
        ← 回首頁
      </Link>
      <h1 className="text-2xl font-black">建立多人比賽</h1>

      <section className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-blue-300">藍方姓名</span>
          <input
            className="min-h-[56px] rounded-lg border-2 border-blue-side/60 bg-panel-2 px-3 text-base"
            value={blueName}
            maxLength={12}
            onChange={(e) => setBlueName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-red-300">紅方姓名</span>
          <input
            className="min-h-[56px] rounded-lg border-2 border-red-side/60 bg-panel-2 px-3 text-base"
            value={redName}
            maxLength={12}
            onChange={(e) => setRedName(e.target.value)}
          />
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold text-slate-400">裁判人數</h2>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton
            tone={judgeMode === 'SINGLE' ? 'primary' : 'neutral'}
            onClick={() => setJudgeMode('SINGLE')}
          >
            單裁判（按下即得分）
          </ActionButton>
          <ActionButton
            tone={judgeMode === 'DUAL' ? 'primary' : 'neutral'}
            onClick={() => setJudgeMode('DUAL')}
          >
            雙裁判（兩人確認）
          </ActionButton>
        </div>
      </section>

      <details className="rounded-xl border border-line bg-panel p-3">
        <summary className="cursor-pointer text-sm font-bold text-slate-300">進階設定</summary>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <p className="text-xs font-bold text-slate-400">
              確認時間窗（本系統訓練參數，非 WT 規定）
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {rules.trainingDefaults.confirmationWindowOptions.map((ms) => (
                <button
                  key={ms}
                  type="button"
                  aria-pressed={confirmationWindowMs === ms}
                  onClick={() => setConfirmationWindowMs(ms)}
                  className={`min-h-[48px] rounded-lg border-2 text-sm font-bold ${
                    confirmationWindowMs === ms
                      ? 'border-emerald-400 bg-emerald-600/25'
                      : 'border-line bg-panel-2 text-slate-300'
                  }`}
                >
                  {ms} ms
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-400">主控 PIN（留空自動產生 4 碼）</span>
            <input
              className="min-h-[56px] rounded-lg border border-line bg-panel-2 px-3 text-base"
              value={hostPin}
              inputMode="numeric"
              maxLength={8}
              onChange={(e) => setHostPin(e.target.value)}
            />
          </label>
        </div>
      </details>

      <NonCertifiedNotice />

      <ActionButton tone="primary" className="min-h-[72px] text-lg" onClick={create}>
        建立房間
      </ActionButton>

      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
        ⚠️ <b>目前為本機模擬模式</b>：房間只在<b>同一台裝置的同一個瀏覽器</b>內有效，
        可用多個分頁分別開啟電視、主控與裁判端來驗證完整流程。
        跨裝置連線需要 Supabase 後端（第三階段），尚未實作。
      </p>
    </div>
  )
}

function RoomCreated({ room, pin }: { room: RoomConfig; pin: string }): React.ReactElement {
  const origin = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`
  const link = (path: string): string => `${origin}#${path}`

  const targets = [
    { label: '電視顯示端', path: `/display/${room.roomCode}` },
    { label: '主控端', path: `/operator/${room.roomCode}` },
    { label: '裁判 A', path: `/judge/${room.roomCode}/A` },
    ...(room.judgeMode === 'SINGLE'
      ? []
      : [{ label: '裁判 B', path: `/judge/${room.roomCode}/B` }]),
  ]

  return (
    <div className="safe-area mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 p-4">
      <Link to="/" className="text-sm font-bold text-slate-400">
        ← 回首頁
      </Link>

      <Panel title="房間已建立">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-slate-400">房間代碼</p>
            <p className="tabular text-5xl font-black tracking-[0.2em]">{room.roomCode}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">主控 PIN</p>
            <p className="tabular text-3xl font-black text-amber-300">{pin}</p>
          </div>
          <div className="text-xs text-slate-400">
            <p>模式：{room.judgeMode === 'SINGLE' ? '單裁判' : '雙裁判'}</p>
            <p>確認時間窗：{room.confirmationWindowMs} ms</p>
            <p>有效至：{new Date(room.expiresAt).toLocaleTimeString('zh-TW')}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          房間代碼只提供「加入」，不等於操作權限；主控端另外需要 PIN。
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        {targets.map((target) => (
          <div key={target.path} className="flex flex-col gap-2">
            <QrCode value={link(target.path)} label={target.label} />
            <Link
              to={target.path}
              className="min-h-[48px] rounded-lg border border-line bg-panel-2 px-3 py-2 text-center text-sm font-bold text-slate-200"
            >
              在本分頁開啟{target.label}
            </Link>
          </div>
        ))}
      </div>

      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
        ⚠️ 本機模擬模式：請用<b>同一個瀏覽器的不同分頁</b>開啟以上連結。
        主控端分頁必須保持開啟，它在模擬模式中扮演伺服器；關閉後裁判端會顯示「主控端未連線」。
      </p>
    </div>
  )
}
