import { describe, expect, it } from 'vitest'
import { applyCommands, createMatchState, reduceMatch } from './matchCore'
import { computeRemainingMs } from '../timer/timer'
import type { MatchState } from '../types'

const T0 = 1_700_000_000_000

function running(overrides = {}): MatchState {
  const state = createMatchState({ totalRounds: 3, roundDurationMs: 60_000, ...overrides }, T0)
  return reduceMatch(state, { type: 'START' }, T0).state
}

/** 讓某一方以指定技術取得該回合勝利，並結束該回合 */
function winRound(state: MatchState, side: 'BLUE' | 'RED', at: number): MatchState {
  const scored = reduceMatch(state, { type: 'SCORE', side, action: 'BODY_KICK' }, at).state
  const ended = reduceMatch(scored, { type: 'TIME_UP' }, at + 1_000).state
  if (ended.matchStatus !== 'REST') return ended
  const ready = reduceMatch(ended, { type: 'TIME_UP' }, at + 2_000).state
  return reduceMatch(ready, { type: 'START' }, at + 3_000).state
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

  it('回合時間到：中間回合進入休息，且分數歸零重新計算', () => {
    const scored = reduceMatch(
      running(),
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      T0 + 1_000,
    ).state
    expect(scored.scores.blueScore).toBe(3)

    const afterRound1 = reduceMatch(scored, { type: 'TIME_UP' }, T0 + 60_000).state
    expect(afterRound1.matchStatus).toBe('REST')
    expect(afterRound1.currentRound).toBe(2)
    // 三回合兩勝制：新回合分數歸零
    expect(afterRound1.scores.blueScore).toBe(0)
    expect(afterRound1.roundWins).toEqual({ blue: 1, red: 0 })
    expect(afterRound1.roundResults[0]).toMatchObject({
      round: 1,
      winner: 'BLUE',
      reason: 'POINTS',
    })

    const round2Ready = reduceMatch(afterRound1, { type: 'TIME_UP' }, T0 + 90_000).state
    expect(round2Ready.matchStatus).toBe('READY')
    expect(computeRemainingMs(round2Ready.timer, T0 + 90_000)).toBe(60_000)
  })

  it('三回合兩勝制：先贏兩回合就結束，不會進行第三回合', () => {
    const afterR1 = winRound(running(), 'BLUE', T0 + 1_000)
    expect(afterR1.currentRound).toBe(2)
    expect(afterR1.matchStatus).toBe('RUNNING')

    const afterR2 = winRound(afterR1, 'BLUE', T0 + 10_000)
    expect(afterR2.matchStatus).toBe('FINISHED')
    expect(afterR2.matchWinner).toBe('BLUE')
    expect(afterR2.roundWins).toEqual({ blue: 2, red: 0 })
    // 只打了兩回合
    expect(afterR2.roundResults).toHaveLength(2)
    expect(afterR2.currentRound).toBe(2)
  })

  it('三回合兩勝制：1:1 時進入第三回合決勝', () => {
    const afterR1 = winRound(running(), 'BLUE', T0 + 1_000)
    const afterR2 = winRound(afterR1, 'RED', T0 + 10_000)
    expect(afterR2.matchStatus).toBe('RUNNING')
    expect(afterR2.currentRound).toBe(3)
    expect(afterR2.roundWins).toEqual({ blue: 1, red: 1 })

    const afterR3 = winRound(afterR2, 'RED', T0 + 20_000)
    expect(afterR3.matchStatus).toBe('FINISHED')
    expect(afterR3.matchWinner).toBe('RED')
  })

  it('分差達門檻（15 分）時該回合當場結束，不必等時間到', () => {
    let state = running()
    // 旋轉頭部 6 分 × 3 = 18 分，第三下時分差達 15
    for (let i = 0; i < 3; i += 1) {
      state = reduceMatch(
        state,
        { type: 'SCORE', side: 'BLUE', action: 'TURNING_HEAD_KICK' },
        T0 + 1_000 + i * 1_000,
      ).state
    }
    expect(state.roundResults[0]).toMatchObject({ winner: 'BLUE', reason: 'POINT_GAP' })
    expect(state.currentRound).toBe(2)
    expect(state.scores.blueScore).toBe(0)
  })

  it('單一回合累積 5 次 Gam-jeom，該回合直接判給對手', () => {
    let state = running()
    for (let i = 0; i < 5; i += 1) {
      state = reduceMatch(
        state,
        { type: 'GAMJEOM', side: 'BLUE', reason: 'OUT_OF_BOUNDS', special: false },
        T0 + 1_000 + i * 1_000,
      ).state
    }
    expect(state.roundResults[0]).toMatchObject({ winner: 'RED', reason: 'GAMJEOM_LIMIT' })
    expect(state.roundWins).toEqual({ blue: 0, red: 1 })
  })

  it('回合平手時不自行猜測，改由主控依優勢判定', () => {
    let state = running()
    state = reduceMatch(
      state,
      { type: 'SCORE', side: 'BLUE', action: 'BODY_KICK' },
      T0 + 1_000,
    ).state
    state = reduceMatch(
      state,
      { type: 'SCORE', side: 'RED', action: 'BODY_KICK' },
      T0 + 2_000,
    ).state
    state = reduceMatch(state, { type: 'TIME_UP' }, T0 + 60_000).state

    expect(state.pendingSuperiorityRound).toBe(1)
    expect(state.roundResults).toHaveLength(0)
    expect(state.timer.timerStatus).not.toBe('RUNNING')

    const decided = reduceMatch(
      state,
      { type: 'DECIDE_SUPERIORITY', winner: 'RED' },
      T0 + 61_000,
    ).state
    expect(decided.pendingSuperiorityRound).toBeNull()
    expect(decided.roundResults[0]).toMatchObject({ winner: 'RED', reason: 'SUPERIORITY' })
    expect(decided.currentRound).toBe(2)
  })

  it('回合平手但旋轉技術得分較多者勝（不需人工判定）', () => {
    let state = running()
    // 藍：旋轉身體 4 分；紅：身體 2 + 身體 2 = 4 分
    state = reduceMatch(
      state,
      { type: 'SCORE', side: 'BLUE', action: 'TURNING_BODY_KICK' },
      T0 + 1_000,
    ).state
    state = reduceMatch(
      state,
      { type: 'SCORE', side: 'RED', action: 'BODY_KICK' },
      T0 + 2_000,
    ).state
    state = reduceMatch(
      state,
      { type: 'SCORE', side: 'RED', action: 'BODY_KICK' },
      T0 + 3_000,
    ).state
    state = reduceMatch(state, { type: 'TIME_UP' }, T0 + 60_000).state

    expect(state.pendingSuperiorityRound).toBeNull()
    expect(state.roundResults[0]).toMatchObject({ winner: 'BLUE', reason: 'TURNING_POINTS' })
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
