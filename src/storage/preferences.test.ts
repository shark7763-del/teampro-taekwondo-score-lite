import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETUP, loadPreferences, savePreferences } from './preferences'
import { WT_2026_06_01_OFFICIAL } from '../rules/ruleSets'

const KEY = 'tp-tkd-score-lite:prefs:v1'

describe('偏好設定的保存與異常恢復', () => {
  afterEach(() => window.localStorage.clear())

  it('沒有資料時回傳預設值', () => {
    expect(loadPreferences()).toEqual({
      soundEnabled: true,
      vibrationEnabled: true,
      lastSetup: DEFAULT_SETUP,
    })
  })

  it('可保存並讀回上一次的比賽設定與開關', () => {
    savePreferences({
      soundEnabled: false,
      vibrationEnabled: true,
      lastSetup: {
        blueName: '王小明',
        redName: '李大同',
        totalRounds: 3,
        roundDurationMs: 60_000,
        restDurationMs: 15_000,
        ruleSetCode: WT_2026_06_01_OFFICIAL.code,
      },
    })
    const prefs = loadPreferences()
    expect(prefs.soundEnabled).toBe(false)
    expect(prefs.lastSetup.blueName).toBe('王小明')
    expect(prefs.lastSetup.roundDurationMs).toBe(60_000)
    expect(prefs.lastSetup.ruleSetCode).toBe(WT_2026_06_01_OFFICIAL.code)
  })

  it('JSON 損毀時不拋出例外，回退為預設值', () => {
    window.localStorage.setItem(KEY, '{ 這不是 JSON')
    expect(() => loadPreferences()).not.toThrow()
    expect(loadPreferences().lastSetup).toEqual(DEFAULT_SETUP)
  })

  it('欄位缺失或型別錯誤時，逐欄回退而不是整包丟掉', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        soundEnabled: 'yes',
        lastSetup: { blueName: '只有藍方', roundDurationMs: 'abc' },
      }),
    )
    const prefs = loadPreferences()
    expect(prefs.soundEnabled).toBe(true) // 型別錯誤 → 預設
    expect(prefs.lastSetup.blueName).toBe('只有藍方') // 有效值保留
    expect(prefs.lastSetup.roundDurationMs).toBe(DEFAULT_SETUP.roundDurationMs)
    expect(prefs.lastSetup.redName).toBe(DEFAULT_SETUP.redName)
  })

  it('數值超出合理範圍時會被夾在安全區間內', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ lastSetup: { roundDurationMs: 9_999_999, totalRounds: 99 } }),
    )
    const prefs = loadPreferences()
    expect(prefs.lastSetup.roundDurationMs).toBe(600_000)
    expect(prefs.lastSetup.totalRounds).toBe(5)
  })
})
