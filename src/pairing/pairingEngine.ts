import type {
  ActionType,
  AthleteSide,
  JudgeSeat,
  PressOutcome,
  RejectionReason,
} from '../types'
import { createId } from '../rules/ruleEngine'

/**
 * 雙裁判（可擴充為三裁判）確認的配對引擎。
 *
 * ⚠️ 這份純函式就是未來 Supabase RPC `submit_judge_press` 的行為規格。
 *    伺服器端實作必須與本檔完全一致，並額外在交易內加上
 *    `pg_advisory_xact_lock(hashtext(match_id))` 以處理真正的併發。
 *
 * 設計上刻意讓「同一組輸入必得同一結果」，因此所有時間都由呼叫端傳入
 * （正式環境傳伺服器時間），絕不在此讀取 Date.now()。
 *
 * 不變條件（invariants）：
 * 1. 同一個 clientEventId 重送永遠不會重複計分
 * 2. 同一位裁判自己按兩次不可能成立
 * 3. 已配對的事件不可再被配對
 * 4. 超過確認時間窗的舊事件不可與新事件配對
 * 5. 兩筆同時送達時，只會產生一個 matchedGroupId
 */

export interface JudgePress {
  id: string
  clientEventId: string
  matchId: string
  deviceId: string
  judgeSeat: JudgeSeat
  athleteSide: AthleteSide
  actionType: ActionType
  /** 伺服器時間；用戶端時間一律不採信 */
  serverCreatedAt: number
  /** 配對成功後填入，同一組的所有 press 共用 */
  matchedGroupId: string | null
  rejectionReason: RejectionReason | null
}

export interface PressInput {
  clientEventId: string
  matchId: string
  deviceId: string
  judgeSeat: JudgeSeat
  athleteSide: AthleteSide
  actionType: ActionType
}

export interface PairingContext {
  presses: readonly JudgePress[]
  /** 確認時間窗（毫秒）。本系統的訓練參數，非 WT 規定 */
  confirmationWindowMs: number
  /** 需要幾位不同席位的裁判確認才成立：單裁判 1、雙裁判 2、三裁判模式設 2（三取二） */
  requiredConfirmations: number
  /** 同一席位、同一方、同一技術的防誤觸冷卻 */
  cooldownMs: number
  /** 同一裝置每秒最多送出次數 */
  maxPressesPerSecond: number
  /** 伺服器時間 */
  now: number
  /** 比賽目前是否接受得分（由比賽狀態機判斷） */
  matchAcceptsScore: boolean
  /** 不接受時的原因 */
  matchRejection?: RejectionReason
}

export interface PairingResult {
  outcome: PressOutcome
  /** 更新後的完整 press 列表（呼叫端負責保存） */
  presses: JudgePress[]
  /** 配對成立時，屬於同一組的所有 press */
  matchedGroup: JudgePress[]
}

/** 事件是否已超過確認時間窗 */
export function isExpired(press: JudgePress, ctx: { now: number; confirmationWindowMs: number }): boolean {
  return ctx.now - press.serverCreatedAt > ctx.confirmationWindowMs
}

/** 尚未配對、尚未過期、也沒有被拒絕的事件 */
export function isPending(
  press: JudgePress,
  ctx: { now: number; confirmationWindowMs: number },
): boolean {
  return press.matchedGroupId === null && press.rejectionReason === null && !isExpired(press, ctx)
}

/**
 * 送出一次裁判按鍵。
 *
 * 回傳的 outcome 有五種：
 * - MATCHED   已達所需人數，正式成立（呼叫端據此建立一筆 score_event）
 * - WAITING   已記錄，等待其他裁判確認
 * - EXPIRED   （由 expirePresses 產生，本函式不會回傳）
 * - REJECTED  被規則擋下（比賽狀態、冷卻、頻率限制…）
 * - DUPLICATE 相同 clientEventId 重送，回傳第一次的結果，不重複計分
 */
export function submitJudgePress(ctx: PairingContext, input: PressInput): PairingResult {
  const presses = [...ctx.presses]

  /* 1. 冪等：相同 clientEventId 一律不重複處理 */
  const existing = presses.find((p) => p.clientEventId === input.clientEventId)
  if (existing !== undefined) {
    return {
      outcome: { status: 'DUPLICATE', clientEventId: input.clientEventId },
      presses,
      matchedGroup:
        existing.matchedGroupId === null
          ? []
          : presses.filter((p) => p.matchedGroupId === existing.matchedGroupId),
    }
  }

  /* 2. 比賽狀態 */
  if (!ctx.matchAcceptsScore) {
    return rejected(presses, ctx.matchRejection ?? 'MATCH_NOT_RUNNING')
  }

  /* 3. 頻率限制（防止惡意或故障裝置洗事件） */
  const withinOneSecond = presses.filter(
    (p) => p.deviceId === input.deviceId && ctx.now - p.serverCreatedAt < 1_000,
  )
  if (withinOneSecond.length >= ctx.maxPressesPerSecond) {
    return rejected(presses, 'RATE_LIMIT')
  }

  /* 4. 防誤觸冷卻：同席位、同一方、同一技術 */
  const lastSame = presses
    .filter(
      (p) =>
        p.judgeSeat === input.judgeSeat &&
        p.athleteSide === input.athleteSide &&
        p.actionType === input.actionType &&
        p.rejectionReason === null,
    )
    .reduce<JudgePress | null>(
      (latest, p) => (latest === null || p.serverCreatedAt > latest.serverCreatedAt ? p : latest),
      null,
    )
  if (lastSame !== null && ctx.now - lastSame.serverCreatedAt < ctx.cooldownMs) {
    return rejected(presses, 'COOLDOWN')
  }

  /* 5. 建立本次事件（一律使用伺服器時間） */
  const press: JudgePress = {
    id: createId(),
    clientEventId: input.clientEventId,
    matchId: input.matchId,
    deviceId: input.deviceId,
    judgeSeat: input.judgeSeat,
    athleteSide: input.athleteSide,
    actionType: input.actionType,
    serverCreatedAt: ctx.now,
    matchedGroupId: null,
    rejectionReason: null,
  }
  presses.push(press)

  /* 6. 尋找可配對的事件：不同席位、相同選手、相同技術、在時間窗內、尚未配對 */
  const seenSeats = new Set<JudgeSeat>([press.judgeSeat])
  const candidates = presses
    .filter(
      (p) =>
        p.id !== press.id &&
        p.judgeSeat !== press.judgeSeat &&
        p.athleteSide === press.athleteSide &&
        p.actionType === press.actionType &&
        isPending(p, ctx),
    )
    // 最早未配對者優先，行為才可預測（A 先送或 B 先送結果一致）
    .sort((a, b) => a.serverCreatedAt - b.serverCreatedAt)

  const partners: JudgePress[] = []
  for (const candidate of candidates) {
    if (seenSeats.has(candidate.judgeSeat)) continue
    seenSeats.add(candidate.judgeSeat)
    partners.push(candidate)
    if (seenSeats.size >= ctx.requiredConfirmations) break
  }

  if (seenSeats.size < ctx.requiredConfirmations) {
    return {
      outcome: {
        status: 'WAITING',
        pressId: press.id,
        expiresAt: press.serverCreatedAt + ctx.confirmationWindowMs,
      },
      presses,
      matchedGroup: [],
    }
  }

  /* 7. 成立：整組共用同一個 matchedGroupId，正式分數只會增加一次 */
  const matchedGroupId = createId()
  const group = [press, ...partners]
  const groupIds = new Set(group.map((p) => p.id))
  const updated = presses.map((p) => (groupIds.has(p.id) ? { ...p, matchedGroupId } : p))

  return {
    outcome: { status: 'MATCHED', matchedGroupId },
    presses: updated,
    matchedGroup: updated.filter((p) => p.matchedGroupId === matchedGroupId),
  }
}

function rejected(presses: JudgePress[], reason: RejectionReason): PairingResult {
  return { outcome: { status: 'REJECTED', reason }, presses, matchedGroup: [] }
}

/** 查詢某一筆等待中的事件目前狀態（給裁判端顯示「等待中／已過期」） */
export function pressStatus(
  presses: readonly JudgePress[],
  pressId: string,
  ctx: { now: number; confirmationWindowMs: number },
): 'MATCHED' | 'WAITING' | 'EXPIRED' | 'UNKNOWN' {
  const press = presses.find((p) => p.id === pressId)
  if (press === undefined) return 'UNKNOWN'
  if (press.matchedGroupId !== null) return 'MATCHED'
  return isExpired(press, ctx) ? 'EXPIRED' : 'WAITING'
}

/** 清掉過舊的事件，避免長時間比賽累積過多資料（不影響已配對的紀錄） */
export function prunePresses(
  presses: readonly JudgePress[],
  ctx: { now: number; keepMs: number },
): JudgePress[] {
  return presses.filter((p) => ctx.now - p.serverCreatedAt <= ctx.keepMs)
}
