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
  /**
   * 回合制規則（三回合兩勝制）。
   * 每回合分數獨立歸零計算，先贏兩回合者獲勝，
   * 因此 2:0 領先時不會進行第三回合。
   */
  round: {
    /** 需贏得幾個回合才算獲勝；由總回合數推導（3 回合 → 2 勝） */
    winsNeededOf: (totalRounds: number) => number
    /** 分差達此門檻時該回合提前結束（2026 由 12 調整為 15） */
    pointGapThreshold: number
    /** 單一回合累積 Gam-jeom 達此數量，該回合直接判給對手 */
    gamjeomLimitPerRound: number
    /**
     * 平手判定是否納入「Gam-jeom 較少者勝」這一項。
     *
     * 正式賽有這一項；但訓練賽現場教練通常希望「真的分不出來就我自己判」，
     * 因此本系統預設關閉，改為直接跳出優勢判定視窗。
     * 需要完全比照正式賽時，把此值改為 true 即可。
     */
    tieBreakUsesGamjeomCount: boolean
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
    '分值與 Gam-jeom 規則依 World Taekwondo 2026 年競賽規則之公開整理資料建置' +
    '（三回合兩勝制、每回合分數歸零、旋轉技術＝基本分兩倍、最後 10 秒消極判罰對手 +2）。' +
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

  round: {
    winsNeededOf: (totalRounds: number) => Math.floor(totalRounds / 2) + 1,
    pointGapThreshold: 15,
    gamjeomLimitPerRound: 5,
    tieBreakUsesGamjeomCount: false,
  },

  trainingDefaults: {
    confirmationWindowMs: 1_000,
    confirmationWindowOptions: [600, 800, 1_000, 1_200, 1_500, 2_000],
    // 高速對打時教練可能 0.3 秒內連按兩次有效攻擊，
    // 冷卻只用來擋手指抖動造成的重複觸發，不可影響正常快速計分。
    pressCooldownMs: 180,
    maxPressesPerSecond: 3,
  },
}

/**
 * 正式規則模式：與訓練模式唯一的差別是回合平手時
 * 仍採用正式賽的「Gam-jeom 較少者勝」，不直接交給教練判定。
 */
export const WT_2026_06_01_OFFICIAL: RuleSetDefinition = {
  ...WT_2026_06_01_TRAINING,
  code: 'WT_2026_06_01_OFFICIAL',
  name: 'WT Competition Rules 2026-06-01（正式規則模式）',
  round: { ...WT_2026_06_01_TRAINING.round, tieBreakUsesGamjeomCount: true },
}

export const RULE_SETS: Readonly<Record<string, RuleSetDefinition>> = {
  [WT_2026_06_01_TRAINING.code]: WT_2026_06_01_TRAINING,
  [WT_2026_06_01_OFFICIAL.code]: WT_2026_06_01_OFFICIAL,
}

export const DEFAULT_RULE_SET_CODE = WT_2026_06_01_TRAINING.code

export function getRuleSet(code: string = DEFAULT_RULE_SET_CODE): RuleSetDefinition {
  return RULE_SETS[code] ?? WT_2026_06_01_TRAINING
}

/** 全系統統一的免責聲明字串，首頁、設定頁、電視端與 README 必須一致 */
export const NON_WT_CERTIFIED_NOTICE = '本系統供訓練賽及模擬賽使用，非 WT 認證競賽設備。'
