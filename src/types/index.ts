/**
 * TeamPro Taekwondo Score Lite — 共用型別
 *
 * 本檔為前端與（第三階段）Supabase schema 的共同語彙。
 * 任何分數數值都不得寫死在此檔以外的地方，一律經由 src/rules 取得。
 */

export type AthleteSide = 'BLUE' | 'RED'

/** 裁判席位。C 為第三階段之後的三裁判模式預留，第一版 UI 不使用。 */
export type JudgeSeat = 'A' | 'B' | 'C'

/** 前端只會送出 ActionType，實際分值一律由伺服器／規則引擎換算，避免竄改。 */
export type ActionType =
  'BODY_PUNCH' | 'BODY_KICK' | 'HEAD_KICK' | 'TURNING_BODY_KICK' | 'TURNING_HEAD_KICK'

/** 基本（非旋轉）技術 */
export type BaseActionType = 'BODY_PUNCH' | 'BODY_KICK' | 'HEAD_KICK'

/** 旋轉技術 */
export type TurningActionType = 'TURNING_BODY_KICK' | 'TURNING_HEAD_KICK'

/**
 * Gam-jeom 原因。
 * OUT_OF_BOUNDS / FALLING_DOWN / AVOIDING 三者在回合最後 10 秒內
 * 屬於「消極行為」，適用加重處罰（對手 +2）。
 */
export type GamjeomReason = 'OUT_OF_BOUNDS' | 'FALLING_DOWN' | 'AVOIDING' | 'OTHER'

export type MatchStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'REST' | 'FINISHED'

export type TimerStatus = 'STOPPED' | 'RUNNING' | 'PAUSED'

/** NO_PSS = 無電子護具簡易訓練模式（第一版預設）；PSS_SIM = 模擬電子護具（Beta，第二版 UI） */
export type ScoringMode = 'NO_PSS' | 'PSS_SIM'

/** 需要幾位裁判確認才成立。TRIPLE 為 schema 預留，第一版 UI 不提供。 */
export type JudgeMode = 'SINGLE' | 'DUAL' | 'TRIPLE'

export type MatchEventType = 'SCORE' | 'GAMJEOM' | 'REVERSAL' | 'MANUAL_ADJUSTMENT'

export type EventSource = 'SOLO' | 'JUDGE_SINGLE' | 'JUDGE_PAIR' | 'OPERATOR'

export interface Scores {
  blueScore: number
  redScore: number
  blueGamjeom: number
  redGamjeom: number
}

/**
 * 回合勝負的判定依據。
 * 三回合兩勝制下，每回合分數獨立歸零計算，先贏兩回合者獲勝。
 */
export type RoundWinReason =
  /** 該回合分數較高 */
  | 'POINTS'
  /** 分數相同：旋轉技術得分較多 */
  | 'TURNING_POINTS'
  /** 分數相同：高分值技術數量較多（3分 → 2分 → 1分） */
  | 'HIGHER_TECHNIQUE'
  /** 分數相同：Gam-jeom 較少 */
  | 'FEWER_GAMJEOM'
  /** 對手該回合累積 Gam-jeom 達上限 */
  | 'GAMJEOM_LIMIT'
  /** 分差達門檻，回合提前結束 */
  | 'POINT_GAP'
  /** 主控／主審依優勢判定 */
  | 'SUPERIORITY'

export interface RoundResult {
  round: number
  blueScore: number
  redScore: number
  blueGamjeom: number
  redGamjeom: number
  winner: AthleteSide | null
  reason: RoundWinReason | null
  decidedAt: number
}

/**
 * 比賽事件（等同資料庫 score_events）。
 *
 * ⚠️ athleteSide 的語意依 type 而不同，這是最容易出錯的地方，故集中定義：
 *  - SCORE            → athleteSide = 「得分的一方」，pointsDelta 加到 athleteSide
 *  - GAMJEOM          → athleteSide = 「被判罰的一方」，gamjeomDelta 加到 athleteSide，
 *                        pointsDelta 加到「對手」
 *  - REVERSAL         → 沿用被復原事件的 athleteSide，兩個 delta 皆取負值
 *  - MANUAL_ADJUSTMENT→ athleteSide = 「分數被調整的一方」
 *
 * 任何元件都不得自己解讀這段語意，一律呼叫 applyEventToScores()。
 */
export interface MatchEvent {
  id: string
  matchId: string
  type: MatchEventType
  athleteSide: AthleteSide
  actionType: ActionType | null
  pointsDelta: number
  gamjeomDelta: number
  source: EventSource
  /** 雙裁判配對成功時的唯一群組 ID；資料庫中為 UNIQUE，用於防止重複計分 */
  matchedGroupId: string | null
  /** REVERSAL 專用；資料庫中為 UNIQUE，確保同一事件只能被復原一次 */
  reversedEventId: string | null
  /** REVERSAL 專用；被復原事件的原始型別，決定 delta 該如何套用 */
  reversedEventType: MatchEventType | null
  round: number
  /** 事件發生時該回合的剩餘毫秒數（用於稽核最後 10 秒判罰） */
  remainingMsAtEvent: number
  ruleSetCode: string
  reason: GamjeomReason | null
  note: string | null
  createdBy: string
  createdAt: number
}

export interface MatchConfig {
  matchId: string
  blueName: string
  redName: string
  totalRounds: number
  roundDurationMs: number
  restDurationMs: number
  scoringMode: ScoringMode
  judgeMode: JudgeMode
  confirmationWindowMs: number
  soundEnabled: boolean
  vibrationEnabled: boolean
  allowScoreWhenPaused: boolean
  enableLast10sGamjeom: boolean
  ruleSetCode: string
}

export interface TimerSnapshot {
  timerStatus: TimerStatus
  /** 伺服器（或單機模式下的本機）時間戳，單位毫秒 */
  timerStartedAt: number | null
  remainingMsAtStart: number
}

export interface MatchState {
  config: MatchConfig
  /** ⚠️ 這是「目前這一回合」的分數，每回合歸零重新計算 */
  scores: Scores
  currentRound: number
  /** 已完成回合的結果，長度即為已打完的回合數 */
  roundResults: RoundResult[]
  /** 各方已贏得的回合數（三回合兩勝制） */
  roundWins: { blue: number; red: number }
  matchStatus: MatchStatus
  timer: TimerSnapshot
  events: MatchEvent[]
  /** 比賽最終勝方；平手或未結束為 null */
  matchWinner: AthleteSide | null
  /** 等待主控依優勢判定回合勝負時，為該回合數 */
  pendingSuperiorityRound: number | null
  updatedAt: number
}

/** 送分嘗試的結果。單機、mock、Supabase RPC 三種實作共用同一組回傳值。 */
export type PressOutcome =
  /** 配對成立；呼叫端據此建立唯一一筆 score_event（分數只會增加一次） */
  | { status: 'MATCHED'; matchedGroupId: string }
  | { status: 'WAITING'; pressId: string; expiresAt: number }
  | { status: 'EXPIRED'; pressId: string }
  | { status: 'REJECTED'; reason: RejectionReason }
  | { status: 'DUPLICATE'; clientEventId: string }

export type RejectionReason =
  | 'MATCH_NOT_RUNNING'
  | 'MATCH_PAUSED'
  | 'MATCH_FINISHED'
  | 'COOLDOWN'
  | 'RATE_LIMIT'
  | 'INVALID_SEAT'
  | 'DEVICE_NOT_IN_ROOM'
  | 'ROOM_EXPIRED'
  | 'OFFLINE'
  | 'NOT_LAST_10_SECONDS'
  | 'ALREADY_REVERSED'
  | 'NO_BASE_KICK_FOR_TURNING_BONUS'
