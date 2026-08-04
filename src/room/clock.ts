/**
 * 跨裝置時鐘校正。
 *
 * 計時器只存 `timerStartedAt + remainingMsAtStart`，各端以「現在時間 − 起算時間」重算。
 * 單機模式沒問題，但電視與手機是兩台裝置，系統時鐘可能差好幾秒，
 * 直接用本機 Date.now() 會讓電視上的秒數與主控端對不起來。
 *
 * 因此每則 STATE 都帶主控端送出時的時間 `sentAt`，接收端據此估算時鐘差：
 *   主控端時間 ≈ 本機時間 + offset
 *
 * 網路延遲會讓 offset 略為偏小（顯示的剩餘時間多幾十毫秒），
 * 對訓練賽而言可忽略，且永遠不會讓電視「提早」歸零。
 */

/** 超過這個差距視為裝置休眠或校時，直接採用新值而不做平滑 */
const JUMP_THRESHOLD_MS = 2_000
/** 平滑係數：越小越穩定，但追上真實差距越慢 */
const SMOOTHING = 0.25

export function offsetSample(sentAt: number, receivedAt: number): number {
  return sentAt - receivedAt
}

/**
 * 以新的樣本更新時鐘差。
 * 平滑處理可避免單次網路抖動讓電視上的秒數跳動。
 */
export function smoothClockOffset(current: number | null, sample: number): number {
  if (current === null) return sample
  if (Math.abs(sample - current) >= JUMP_THRESHOLD_MS) return sample
  return current + (sample - current) * SMOOTHING
}
