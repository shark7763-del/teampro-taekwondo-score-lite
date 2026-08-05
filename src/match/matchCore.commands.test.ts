import { describe, expect, it } from 'vitest'
import { applyCommands, createMatchState, reduceMatch } from './matchCore'
import type { MatchCommand } from './matchCore'
import { computeRoundScores } from '../rules/ruleEngine'
import type { MatchState } from '../types'

/**
 * 狀態機中「從未被執行到」的指令。
 *
 * 突變測試顯示 matchCore.ts 有 79 個突變體完全沒被任何測試執行到，
 * 集中在計時控制（PAUSE / RESET_ROUND_TIME / ADJUST_TIME）、
 * 回合回溯（PREV_ROUND）與設定類指令（RENAME / SWAP_SIDES / SET_OPTIONS）。
 * 這些指令在現場都會被按到，只是先前沒有測試守著。
 */

const T0 = 1_700_000_000_000

function newMatch(overrides = {}): MatchState {
  return createMatchState(
    { totalRounds: 3, roundDurationMs: 90_000, restDurationMs: 30_000, ...overrides },
    T0,
  )
}

function run(state: MatchState, commands: MatchCommand[], stepMs = 10): MatchState {
  return applyCommands(state, commands, T0, stepMs)
}

describe('計時控制', () => {
  it('暫停會把剩餘時間固定住，之後時間不再流逝', () => {
    const started = reduceMatch(newMatch(), { type: 'START' }, T0).state
    const paused = reduceMatch(started, { type: 'PAUSE' }, T0 + 30_000).state

    expect(paused.matchStatus).toBe('PAUSED')
    expect(paused.timer.timerStatus).toBe('PAUSED')
    expect(paused.timer.timerStartedAt).toBeNull()
    expect(paused.timer.remainingMsAtStart).toBe(60_000)
  })

  it('沒有在跑的時候按暫停會被拒絕', () => {
    const result = reduceMatch(newMatch(), { type: 'PAUSE' }, T0)
    expect(result.rejected).toBe('INVALID_COMMAND')
  })

  it('暫停後恢復，剩餘時間從暫停的那一刻接續', () => {
    let state = reduceMatch(newMatch(), { type: 'START' }, T0).state
    state = reduceMatch(state, { type: 'PAUSE' }, T0 + 30_000).state
    state = reduceMatch(state, { type: 'RESUME' }, T0 + 120_000).state

    expect(state.matchStatus).toBe('RUNNING')
    expect(state.timer.timerStartedAt).toBe(T0 + 120_000)
    expect(state.timer.remainingMsAtStart).toBe(60_000)
  })

  it('剩餘時間為 0 時不得開始', () => {
    let state = reduceMatch(newMatch({ roundDurationMs: 1_000 }), { type: 'START' }, T0).state
    state = reduceMatch(state, { type: 'PAUSE' }, T0 + 5_000).state
    const result = reduceMatch(state, { type: 'START' }, T0 + 6_000)
    expect(result.rejected).toBe('INVALID_COMMAND')
  })

  it('重設回合時間會回到 READY 並還原完整回合長度', () => {
    let state = reduceMatch(newMatch(), { type: 'START' }, T0).state
    state = reduceMatch(state, { type: 'RESET_ROUND_TIME' }, T0 + 40_000).state

    expect(state.matchStatus).toBe('READY')
    expect(state.timer.timerStatus).toBe('STOPPED')
    expect(state.timer.remainingMsAtStart).toBe(90_000)
  })

  it('比賽結束後不得重設回合時間', () => {
    const finished = run(newMatch(), [{ type: 'START' }, { type: 'FINISH' }])
    expect(reduceMatch(finished, { type: 'RESET_ROUND_TIME' }, T0).rejected).toBe('MATCH_FINISHED')
  })

  it('調整時間可以加時也可以減時，且不會變成負數', () => {
    const ready = newMatch()
    const plus = reduceMatch(ready, { type: 'ADJUST_TIME', deltaMs: 10_000 }, T0).state
    expect(plus.timer.remainingMsAtStart).toBe(100_000)

    const minus = reduceMatch(ready, { type: 'ADJUST_TIME', deltaMs: -999_000 }, T0).state
    expect(minus.timer.remainingMsAtStart).toBe(0)
  })

  it('計時中調整時間會以調整後的值重新起算', () => {
    let state = reduceMatch(newMatch(), { type: 'START' }, T0).state
    state = reduceMatch(state, { type: 'ADJUST_TIME', deltaMs: 5_000 }, T0 + 30_000).state

    expect(state.timer.timerStatus).toBe('RUNNING')
    expect(state.timer.timerStartedAt).toBe(T0 + 30_000)
    expect(state.timer.remainingMsAtStart).toBe(65_000)
  })

  it('比賽結束後不得調整時間', () => {
    const finished = run(newMatch(), [{ type: 'START' }, { type: 'FINISH' }])
    expect(reduceMatch(finished, { type: 'ADJUST_TIME', deltaMs: 1_000 }, T0).rejected).toBe(
      'MATCH_FINISHED',
    )
  })
})

describe('休息與回合推進', () => {
  it('休息中按開始只會跑休息倒數，不會把狀態變成比賽進行中', () => {
    let state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'NEXT_ROUND' },
    ])
    expect(state.matchStatus).toBe('REST')

    state = reduceMatch(state, { type: 'START' }, T0 + 1_000).state
    expect(state.matchStatus).toBe('REST')
    expect(state.timer.timerStatus).toBe('RUNNING')
  })

  it('休息時間到會進入下一回合的待命狀態，並換回合時間', () => {
    let state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'NEXT_ROUND' },
    ])
    state = reduceMatch(state, { type: 'TIME_UP' }, T0 + 60_000).state

    expect(state.matchStatus).toBe('READY')
    expect(state.currentRound).toBe(2)
    expect(state.timer.remainingMsAtStart).toBe(90_000)
  })

  it('等待優勢判定期間不得推進回合，也不會被 TIME_UP 推走', () => {
    const tied = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'SCORE', side: 'RED', action: 'HEAD_KICK' },
      { type: 'NEXT_ROUND' },
    ])
    expect(tied.pendingSuperiorityRound).toBe(1)

    expect(reduceMatch(tied, { type: 'NEXT_ROUND' }, T0 + 1_000).rejected).toBe('INVALID_COMMAND')
    expect(reduceMatch(tied, { type: 'TIME_UP' }, T0 + 1_000).state).toBe(tied)
  })

  it('沒有待判定的回合時，優勢判定指令會被拒絕', () => {
    const started = run(newMatch(), [{ type: 'START' }])
    expect(reduceMatch(started, { type: 'DECIDE_SUPERIORITY', winner: 'BLUE' }, T0).rejected).toBe(
      'INVALID_COMMAND',
    )
  })

  it('比賽結束後不得推進回合', () => {
    const finished = run(newMatch(), [{ type: 'START' }, { type: 'FINISH' }])
    expect(reduceMatch(finished, { type: 'NEXT_ROUND' }, T0).rejected).toBe('MATCH_FINISHED')
  })
})

describe('回到上一回合（修正結果）', () => {
  it('會退回上一回合並抵銷該回合的勝場', () => {
    let state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'NEXT_ROUND' },
    ])
    expect(state.roundWins).toEqual({ blue: 1, red: 0 })
    expect(state.currentRound).toBe(2)

    state = reduceMatch(state, { type: 'PREV_ROUND' }, T0 + 1_000).state

    expect(state.currentRound).toBe(1)
    expect(state.roundResults).toHaveLength(0)
    expect(state.roundWins).toEqual({ blue: 0, red: 0 })
    expect(state.matchStatus).toBe('READY')
    expect(state.matchWinner).toBeNull()
    // 該回合的得分紀錄仍在
    expect(state.scores.blueScore).toBe(3)
  })

  it('還沒有任何回合結果時會被拒絕', () => {
    expect(reduceMatch(newMatch(), { type: 'PREV_ROUND' }, T0).rejected).toBe('INVALID_COMMAND')
  })

  it('比賽結束後回到上一回合會解除結束狀態', () => {
    let state = newMatch()
    for (const round of [1, 2]) {
      state = reduceMatch(state, { type: 'START' }, T0 + round * 1_000).state
      state = reduceMatch(
        state,
        { type: 'SCORE', side: 'RED', action: 'HEAD_KICK' },
        T0 + round * 1_000 + 100,
      ).state
      state = reduceMatch(state, { type: 'NEXT_ROUND' }, T0 + round * 1_000 + 200).state
      if (round === 1) state = reduceMatch(state, { type: 'NEXT_ROUND' }, T0 + 1_300).state
    }
    expect(state.matchStatus).toBe('FINISHED')
    expect(state.matchWinner).toBe('RED')

    state = reduceMatch(state, { type: 'PREV_ROUND' }, T0 + 9_000).state
    expect(state.matchStatus).toBe('READY')
    expect(state.matchWinner).toBeNull()
    expect(state.roundWins).toEqual({ blue: 0, red: 1 })
  })
})

describe('手動修正', () => {
  it('必須填寫原因，空白會被拒絕', () => {
    const started = run(newMatch(), [{ type: 'START' }])
    const result = reduceMatch(
      started,
      { type: 'MANUAL_ADJUST', side: 'BLUE', deltaPoints: -1, note: '   ' },
      T0,
    )
    expect(result.rejected).toBe('INVALID_COMMAND')
  })

  it('修正會留下事件紀錄，不是直接改分數', () => {
    let state = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
    ])
    state = reduceMatch(
      state,
      { type: 'MANUAL_ADJUST', side: 'BLUE', deltaPoints: -1, note: '誤判' },
      T0 + 500,
    ).state

    expect(state.scores.blueScore).toBe(2)
    expect(state.events).toHaveLength(2)
    expect(state.events[1]?.type).toBe('MANUAL_ADJUSTMENT')
    expect(state.events[1]?.note).toBe('誤判')
  })

  it('比賽結束後不得手動修正', () => {
    const finished = run(newMatch(), [{ type: 'START' }, { type: 'FINISH' }])
    expect(
      reduceMatch(finished, { type: 'MANUAL_ADJUST', side: 'BLUE', deltaPoints: 1, note: 'x' }, T0)
        .rejected,
    ).toBe('MATCH_FINISHED')
  })
})

describe('選手姓名與偏好', () => {
  it('改名會去除前後空白並限制長度', () => {
    const state = reduceMatch(
      newMatch(),
      { type: 'RENAME', side: 'BLUE', name: '  王小明王小明王小明王小明王小明  ' },
      T0,
    ).state
    expect(state.config.blueName).toBe('王小明王小明王小明王小明')
    expect(state.config.blueName).toHaveLength(12)
  })

  it('改成空字串會退回預設稱呼', () => {
    const blue = reduceMatch(newMatch(), { type: 'RENAME', side: 'BLUE', name: '  ' }, T0).state
    const red = reduceMatch(newMatch(), { type: 'RENAME', side: 'RED', name: '' }, T0).state
    expect(blue.config.blueName).toBe('藍方')
    expect(red.config.redName).toBe('紅方')
  })

  it('交換只換姓名，分數與版位都不動', () => {
    let state = reduceMatch(
      newMatch({ blueName: '甲', redName: '乙' }),
      { type: 'START' },
      T0,
    ).state
    state = reduceMatch(state, { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' }, T0 + 100).state
    const before = state.scores
    state = reduceMatch(state, { type: 'SWAP_SIDES' }, T0 + 200).state

    expect(state.config.blueName).toBe('乙')
    expect(state.config.redName).toBe('甲')
    expect(state.scores).toEqual(before)
  })

  it('調整音效與震動不會動到任何計分狀態', () => {
    const started = run(newMatch(), [
      { type: 'START' },
      { type: 'SCORE', side: 'RED', action: 'BODY_KICK' },
    ])
    const quiet = reduceMatch(
      started,
      { type: 'SET_OPTIONS', soundEnabled: false, vibrationEnabled: false },
      T0 + 500,
    ).state

    expect(quiet.config.soundEnabled).toBe(false)
    expect(quiet.config.vibrationEnabled).toBe(false)
    expect(quiet.scores).toEqual(started.scores)
    expect(quiet.events).toEqual(started.events)
  })

  it('只給其中一項時，另一項維持原值', () => {
    const state = reduceMatch(newMatch(), { type: 'SET_OPTIONS', soundEnabled: false }, T0).state
    expect(state.config.soundEnabled).toBe(false)
    expect(state.config.vibrationEnabled).toBe(true)
  })
})

describe('重新開始', () => {
  it('沿用設定與姓名，但是全新的 matchId 與空紀錄', () => {
    const played = run(newMatch({ blueName: '甲', redName: '乙' }), [
      { type: 'START' },
      { type: 'SCORE', side: 'BLUE', action: 'HEAD_KICK' },
      { type: 'GAMJEOM', side: 'RED', reason: 'OTHER', special: false },
    ])
    const fresh = reduceMatch(played, { type: 'RESTART' }, T0 + 5_000).state

    expect(fresh.config.blueName).toBe('甲')
    expect(fresh.config.redName).toBe('乙')
    expect(fresh.config.matchId).not.toBe(played.config.matchId)
    expect(fresh.events).toHaveLength(0)
    expect(fresh.currentRound).toBe(1)
    expect(fresh.roundResults).toHaveLength(0)
    expect(fresh.matchStatus).toBe('READY')
    expect(computeRoundScores(fresh.events, 1)).toMatchObject({ blueScore: 0, redScore: 0 })
  })
})

describe('無效指令', () => {
  it('未知指令會被拒絕且狀態不變', () => {
    const state = newMatch()
    const result = reduceMatch(state, { type: 'NOPE' } as unknown as MatchCommand, T0)
    expect(result.rejected).toBe('INVALID_COMMAND')
    expect(result.state).toBe(state)
  })
})
