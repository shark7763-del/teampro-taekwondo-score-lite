/**
 * 操作被拒絕時給使用者看的說明。
 *
 * ⚠️ 每新增一種 RejectionReason，都必須在這裡補上對應文案。
 *    少一筆就會落到「操作被拒絕」這種等於沒講的訊息——
 *    現場教練只會覺得「按了沒反應」，然後開始亂按。
 */
const TEXT: Record<string, string> = {
  MATCH_FINISHED: '比賽已結束，無法計分',
  MATCH_PAUSED: '暫停中不接受計分',
  MATCH_NOT_RUNNING: '請先按「開始」',
  NOT_LAST_10_SECONDS: '僅限回合最後 10 秒且比賽進行中才能使用',
  NOTHING_TO_REVERSE: '沒有可復原的紀錄',
  INVALID_COMMAND: '此操作目前不可執行',
  ALREADY_REVERSED: '這筆紀錄已經復原過了',
  WOULD_GO_NEGATIVE: '扣完會變成負分，已取消（分數不能低於 0）',
  COOLDOWN: '按得太快，請稍候再試',
  RATE_LIMIT: '送出次數過於頻繁',
  OFFLINE: '目前離線，無法送出',
  ROOM_EXPIRED: '房間已過期，請重新建立',
  NO_BASE_KICK_FOR_TURNING_BONUS: '需要先有同一方的基本踢擊得分',
}

export function rejectionText(reason: string): string {
  return TEXT[reason] ?? '操作被拒絕'
}
