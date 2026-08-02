import { describe, expect, it } from 'vitest'
import { applyCommands, createMatchState, reduceMatch } from './matchCore'
import { computeRemainingMs } from '../timer/timer'
import type { MatchState } from '../types'

const T0 = 1_700_000_000_000

function running(overrides = {}): MatchState {
  const state = createMatchState({ totalRounds: 2, roundDurationMs: 60_000, ...overrides }, T0)
  return reduceMatch(state, { type: 'START' }, T0).state
}

describe('比賽狀態機（單機模式核心）', () => {
  it('#32 單機模式可離線完成一輪計分（不需要任何網路或伺服器）', () => {
    const state = applyCommands(
      running(),
      [
        { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
        { type: 'SCORE', side: 'RED', action: 'HEAD_KICK' },
        { type: 'SCORE', side: 'BLUE', action: 'TURNING_HEAD_KICK' },
      ],
      T0 + 1_000,
      500,
    )
    expect(state.scores.blueScore).toBe(8)
    expect(state.scores.redScore).toBe(3)
    expect(state.events).toHaveLength(3)
  })

  it('#22 比賽結束後不可再得分', () => {
    const finished = reduceMatch(running(), { type: 'FINISH' }, T0 + 1_000).state
    const result = reduceMatch(
      finished,
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
      T0 + 2_000,
    )
    expect(result.rejected).toBe('MATCH_FINISHED')
    expect(result.state.scores.blueScore).toBe(0)
  })

  it('#23 暫停時依設定拒絕或接受得分', () => {
    const paused = reduceMatch(running(), { type: 'PAUSE' }, T0 + 5_000).state
    const rejected = reduceMatch(
      paused,
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
      T0 + 6_000,
    )
    expect(rejected.rejected).toBe('MATCH_PAUSED')

    const allowState = reduceMatch(
      running({ allowScoreWhenPaused: true }),
      { type: 'PAUSE' },
      T0 + 5_000,
    ).state
    const accepted = reduceMatch(
      allowState,
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
      T0 + 6_000,
    )
    expect(accepted.rejected).toBeUndefined()
    expect(accepted.state.scores.blueScore).toBe(2)
  })

  it('尚未開始（READY）時不得得分，避免熱身誤觸', () => {
    const ready = createMatchState({}, T0)
    expect(
      reduceMatch(ready, { type: 'SCORE', side: 'RED', action: 'BODY_PUNCH' }, T0).rejected,
    ).toBe('MATCH_NOT_RUNNING')
  })

  it('Gam-jeom 由主控操作，藍方違規時紅方得分', () => {
    const result = reduceMatch(
      running(),
      { type: 'GAMJEOM', side: 'BLUE', reason: 'OUT_OF_BOUNDS', special: false },
      T0 + 1_000,
    )
    expect(result.state.scores.redScore).toBe(1)
    expect(result.state.scores.blueGamjeom).toBe(1)
  })

  it('最後 10 秒特殊 Gam-jeom：時間不符時後端層級直接拒絕', () => {
    const state = running()
    const tooEarly = reduceMatch(
      state,
      { type: 'GAMJEOM', side: 'BLUE', reason: 'AVOIDING', special: true },
      T0 + 1_000, // 剩 59 秒
    )
    expect(tooEarly.rejected).toBe('NOT_LAST_10_SECONDS')

    const inWindow = reduceMatch(
      state,
      { type: 'GAMJEOM', side: 'BLUE', reason: 'AVOIDING', special: true },
      T0 + 52_000, // 剩 8 秒
    )
    expect(inWindow.rejected).toBeUndefined()
    expect(inWindow.state.scores.redScore).toBe(2)
    expect(inWindow.state.scores.blueGamjeom).toBe(1)
  })

  it('復原上一筆：分數回復且原紀錄保留，重複復原會被拒絕', () => {
    const scored = reduceMatch(
      running(),
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      T0 + 1_000,
    ).state
    expect(scored.scores.blueScore).toBe(3)

    const undone = reduceMatch(scored, { type: 'UNDO' }, T0 + 2_000)
    expect(undone.state.scores.blueScore).toBe(0)
    expect(undone.state.events).toHaveLength(2)

    const again = reduceMatch(undone.state, { type: 'UNDO' }, T0 + 3_000)
    expect(again.rejected).toBe('NOTHING_TO_REVERSE')
  })

  it('手動修正必須輸入原因，且會留下紀錄', () => {
    const state = running()
    expect(
      reduceMatch(state, { type: 'MANUAL_ADJUST', side: 'BLUE', deltaPoints: 2, note: '  ' }, T0)
        .rejected,
    ).toBe('INVALID_COMMAND')

    const ok = reduceMatch(
      state,
      { type: 'MANUAL_ADJUST', side: 'BLUE', deltaPoints: -2, note: '誤判補正' },
      T0 + 1_000,
    )
    expect(ok.state.events[0]?.note).toBe('誤判補正')
  })

  it('回合時間到：中間回合進入休息，最後一回合結束比賽', () => {
    const state = running()
    const afterRound1 = reduceMatch(state, { type: 'TIME_UP' }, T0 + 60_000).state
    expect(afterRound1.matchStatus).toBe('REST')
    expect(afterRound1.currentRound).toBe(2)

    const round2Ready = reduceMatch(afterRound1, { type: 'TIME_UP' }, T0 + 90_000).state
    expect(round2Ready.matchStatus).toBe('READY')
    expect(computeRemainingMs(round2Ready.timer, T0 + 90_000)).toBe(60_000)

    const round2Running = reduceMatch(round2Ready, { type: 'START' }, T0 + 91_000).state
    const finished = reduceMatch(round2Running, { type: 'TIME_UP' }, T0 + 151_000).state
    expect(finished.matchStatus).toBe('FINISHED')
  })

  it('分數與計時互不干擾：計分不會改變剩餘時間', () => {
    const state = running()
    const before = computeRemainingMs(state.timer, T0 + 10_000)
    const scored = reduceMatch(
      state,
      { type: 'SCORE', side: 'RED', action: 'BODY_KICK' },
      T0 + 10_000,
    ).state
    expect(computeRemainingMs(scored.timer, T0 + 10_000)).toBe(before)
  })

  it('改名與交換紅藍：版位固定，只換姓名', () => {
    const named = applyCommands(
      createMatchState({}, T0),
      [
        { type: 'RENAME', side: 'BLUE', name: '王小明' },
        { type: 'RENAME', side: 'RED', name: '李大同' },
        { type: 'SWAP_SIDES' },
      ],
      T0,
    )
    expect(named.config.blueName).toBe('李大同')
    expect(named.config.redName).toBe('王小明')
  })

  it('重新開賽會清空分數與紀錄，但保留設定', () => {
    const played = reduceMatch(
      running({ blueName: '甲' }),
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
      T0 + 1_000,
    ).state
    const restarted = reduceMatch(played, { type: 'RESTART' }, T0 + 2_000).state
    expect(restarted.scores.blueScore).toBe(0)
    expect(restarted.events).toHaveLength(0)
    expect(restarted.config.blueName).toBe('甲')
    expect(restarted.config.matchId).not.toBe(played.config.matchId)
  })
})
