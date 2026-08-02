import { useState } from 'react'
import type { MatchSetup } from '../storage/preferences'
import { REST_DURATION_PRESETS, ROUND_DURATION_PRESETS } from '../storage/preferences'
import { WT_2026_06_01_OFFICIAL, WT_2026_06_01_TRAINING } from '../rules/ruleSets'
import { ActionButton, NonCertifiedNotice } from './ui'

interface SetupPanelProps {
  initial: MatchSetup
  onStart: (setup: MatchSetup) => void
  onCancel: () => void
}

/**
 * 設定新比賽。
 *
 * 目標是「從開啟系統到開始比賽不超過 10 秒」，因此：
 * - 所有欄位都有沿用上一次的預設值，直接按最下方按鈕即可開賽
 * - 時間採用一鍵切換的快速選項，不需要打字
 */
export function SetupPanel({ initial, onStart, onCancel }: SetupPanelProps): React.ReactElement {
  const [setup, setSetup] = useState<MatchSetup>(initial)
  const [customRound, setCustomRound] = useState(
    !ROUND_DURATION_PRESETS.some((p) => p.ms === initial.roundDurationMs),
  )

  const patch = (next: Partial<MatchSetup>): void =>
    setSetup((current) => ({ ...current, ...next }))

  return (
    <div className="safe-area mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-black">設定新比賽</h1>
        <ActionButton tone="ghost" className="min-h-[44px] px-3 text-sm" onClick={onCancel}>
          取消
        </ActionButton>
      </header>

      <section className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-blue-300">藍方姓名</span>
          <input
            className="min-h-[56px] rounded-lg border-2 border-blue-side/60 bg-panel-2 px-3 text-base"
            value={setup.blueName}
            maxLength={12}
            onChange={(e) => patch({ blueName: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-red-300">紅方姓名</span>
          <input
            className="min-h-[56px] rounded-lg border-2 border-red-side/60 bg-panel-2 px-3 text-base"
            value={setup.redName}
            maxLength={12}
            onChange={(e) => patch({ redName: e.target.value })}
          />
        </label>
      </section>

      <Field label="每回合時間">
        <div className="grid grid-cols-2 gap-2">
          {ROUND_DURATION_PRESETS.map((preset) => (
            <Chip
              key={preset.ms}
              active={!customRound && setup.roundDurationMs === preset.ms}
              label={preset.label}
              onClick={() => {
                setCustomRound(false)
                patch({ roundDurationMs: preset.ms })
              }}
            />
          ))}
          <Chip active={customRound} label="自訂" onClick={() => setCustomRound(true)} />
          {customRound && (
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={600}
                className="min-h-[56px] flex-1 rounded-lg border-2 border-line bg-panel-2 px-3 text-base"
                value={Math.round(setup.roundDurationMs / 1000)}
                onChange={(e) =>
                  patch({
                    roundDurationMs:
                      Math.min(600, Math.max(10, Number(e.target.value) || 10)) * 1000,
                  })
                }
              />
              <span className="text-sm text-slate-400">秒</span>
            </label>
          )}
        </div>
      </Field>

      <Field label="休息時間">
        <div className="grid grid-cols-3 gap-2">
          {REST_DURATION_PRESETS.map((preset) => (
            <Chip
              key={preset.ms}
              active={setup.restDurationMs === preset.ms}
              label={preset.label}
              onClick={() => patch({ restDurationMs: preset.ms })}
            />
          ))}
        </div>
      </Field>

      <Field label="賽制">
        <div className="grid grid-cols-2 gap-2">
          <Chip
            active={setup.totalRounds === 3}
            label="3 回合 2 勝"
            onClick={() => patch({ totalRounds: 3 })}
          />
          <Chip
            active={setup.totalRounds === 1}
            label="單回合定勝負"
            onClick={() => patch({ totalRounds: 1 })}
          />
        </div>
      </Field>

      <Field label="規則模式">
        <div className="grid grid-cols-2 gap-2">
          <Chip
            active={setup.ruleSetCode === WT_2026_06_01_TRAINING.code}
            label="訓練模式"
            sub="平手由教練判定"
            onClick={() => patch({ ruleSetCode: WT_2026_06_01_TRAINING.code })}
          />
          <Chip
            active={setup.ruleSetCode === WT_2026_06_01_OFFICIAL.code}
            label="正式規則模式"
            sub="平手比 Gam-jeom"
            onClick={() => patch({ ruleSetCode: WT_2026_06_01_OFFICIAL.code })}
          />
        </div>
      </Field>

      <NonCertifiedNotice />

      <ActionButton
        tone="primary"
        className="min-h-[72px] text-lg"
        onClick={() =>
          onStart({
            ...setup,
            blueName: setup.blueName.trim() === '' ? '藍方' : setup.blueName.trim(),
            redName: setup.redName.trim() === '' ? '紅方' : setup.redName.trim(),
          })
        }
      >
        開始比賽
      </ActionButton>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-bold text-slate-400">{label}</h2>
      {children}
    </section>
  )
}

function Chip({
  active,
  label,
  sub,
  onClick,
}: {
  active: boolean
  label: string
  sub?: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'flex min-h-[56px] flex-col items-center justify-center rounded-lg border-2 px-2 text-sm font-bold',
        'focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none',
        active
          ? 'border-emerald-400 bg-emerald-600/25 text-white'
          : 'border-line bg-panel-2 text-slate-300',
      ].join(' ')}
    >
      {label}
      {sub !== undefined && <span className="text-[0.65rem] font-normal opacity-80">{sub}</span>}
    </button>
  )
}
