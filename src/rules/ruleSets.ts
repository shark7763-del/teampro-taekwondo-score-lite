import type { BaseActionType, GamjeomReason, TurningActionType } from '../types'

/**
 * 規則集定義（等同資料庫 rule_sets.rules jsonb）。
 *
 * ⚠️ 分值一律由此推導，元件內禁止出現 1 / 2 / 3 / 4 / 6 這些魔術數字。
 * ⚠️ 旋轉技術採「基本分 × turningMultiplier」，不可寫死 4 與 6。
 *    2026 規則將技術分由舊制「+2」改為「基本分的兩倍」，
 *    因此旋轉身體 = 2×2 = 4、旋轉頭部 = 3×2 = 6。
 */
export interface RuleSetDefinition {
  code: string
  name: string
  /** 規則生效日，顯示於畫面與紀錄 */
  effectiveDate: string
  /** 來源說明，必須誠實標示哪些是官方規則、哪些是本系統的訓練設定 */
  sourceNote: string
  officialSourceVerified: boolean
  basePoints: Record<BaseActionType, number>
  turningMultiplier: number
  /** 旋轉技術一定是踢擊，故對應的基本技術限定為兩種踢擊 */
  turningBaseOf: Record<TurningActionType, 'BODY_KICK' | 'HEAD_KICK'>
  gamjeom: {
    /** 一般 Gam-jeom：對手獲得的分數 */
    normalOpponentPoints: number
    /** 回合最後 N 秒內因消極行為判罰時：對手獲得的分數 */
    lastSecondsOpponentPoints: number
    /** 「最後 N 秒」的長度（毫秒） */
    lastSecondsWindowMs: number
    /** 適用加重處罰的消極行為 */
    lastSecondsReasons: readonly GamjeomReason[]
  }
  /**
   * PSS 模擬模式（第一版僅保留資料與規則，UI 為第二版）。
   * autoBase 由護具自動判定；judgeAdditional 為裁判確認的追加分。
   * 追加分 = 基本分 ×(turningMultiplier − 1)，故身體 +2、頭部 +3。
   */
  pss: {
    autoBase: Record<'BODY_KICK' | 'HEAD_KICK', number>
    judgePunchPoints: number
    /** 旋轉追加分是否必須先有同一方的基本踢擊得分事件 */
    turningBonusRequiresBaseKick: boolean
    /** 追認旋轉追加分時，回溯尋找基本踢擊事件的時間範圍（毫秒） */
    turningBonusLookbackMs: number
  }
  /** 本系統自訂的訓練參數，非 WT 規定 */
  trainingDefaults: {
    confirmationWindowMs: number
    confirmationWindowOptions: readonly number[]
    /** 同一裁判、同一方、同一技術的防誤觸冷卻 */
    pressCooldownMs: number
    /** 同一裝置每秒最多送出次數 */
    maxPressesPerSecond: number
  }
}

export const WT_2026_06_01_TRAINING: RuleSetDefinition = {
  code: 'WT_2026_06_01_TRAINING',
  name: 'WT Competition Rules 2026-06-01（訓練用）',
  effectiveDate: '2026-06-01',
  sourceNote:
    '分值與 Gam-jeom 規則依 World Taekwondo 2026 年競賽規則之公開整理資料建置（旋轉技術＝基本分兩倍、最後 10 秒消極判罰對手 +2）。' +
    '⚠️ 尚未逐條比對 WT 官方 PDF 原文，正式引用前請核對官方文件。' +
    '⚠️ 雙裁判確認時間窗為本系統的訓練操作參數，World Taekwondo 並無此秒數規定。',
  officialSourceVerified: false,

  basePoints: {
    BODY_PUNCH: 1,
    BODY_KICK: 2,
    HEAD_KICK: 3,
  },
  turningMultiplier: 2,
  turningBaseOf: {
    TURNING_BODY_KICK: 'BODY_KICK',
    TURNING_HEAD_KICK: 'HEAD_KICK',
  },

  gamjeom: {
    normalOpponentPoints: 1,
    lastSecondsOpponentPoints: 2,
    lastSecondsWindowMs: 10_000,
    lastSecondsReasons: ['OUT_OF_BOUNDS', 'FALLING_DOWN', 'AVOIDING'],
  },

  pss: {
    autoBase: {
      BODY_KICK: 2,
      HEAD_KICK: 3,
    },
    judgePunchPoints: 1,
    turningBonusRequiresBaseKick: true,
    turningBonusLookbackMs: 3_000,
  },

  trainingDefaults: {
    confirmationWindowMs: 1_000,
    confirmationWindowOptions: [600, 800, 1_000, 1_200, 1_500, 2_000],
    pressCooldownMs: 400,
    maxPressesPerSecond: 3,
  },
}

export const RULE_SETS: Readonly<Record<string, RuleSetDefinition>> = {
  [WT_2026_06_01_TRAINING.code]: WT_2026_06_01_TRAINING,
}

export const DEFAULT_RULE_SET_CODE = WT_2026_06_01_TRAINING.code

export function getRuleSet(code: string = DEFAULT_RULE_SET_CODE): RuleSetDefinition {
  return RULE_SETS[code] ?? WT_2026_06_01_TRAINING
}

/** 全系統統一的免責聲明字串，首頁、設定頁、電視端與 README 必須一致 */
export const NON_WT_CERTIFIED_NOTICE = '本系統供訓練賽及模擬賽使用，非 WT 認證競賽設備。'
