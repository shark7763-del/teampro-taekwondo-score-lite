import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { OperatorPage } from '../../src/pages/RoomPages'
import { SoloPage } from '../../src/pages/SoloPage'
import { createMatchState } from '../../src/match/matchCore'
import { createRoomConfig, saveRoom } from '../../src/room/roomStorage'
import { saveSoloMatch } from '../../src/storage/soloStorage'
import type { MatchConfig } from '../../src/types'

/**
 * 黃金測試：單機模式與房間模式的行為必須一致。
 *
 * ⚠️ 本檔為鎖定檔案，AutoResearch 迴圈不得修改。
 *
 * 存在的理由：`reduceMatch` 是兩種模式共用的純函式，所以規則本身不會分岐；
 * 真正會分岐的是**接線**——某一種模式忘了把某個指令接上去。
 * 2026-08-06 就發生過一次：`TIME_UP` 只有單機模式的 hook 會觸發，
 * 房間模式的回合倒數歸零後永遠不結算，而當時 123 條測試沒有一條抓得到。
 */

const ROOM = 'GOLDEN'
/** 用極短回合讓「時間到」在測試中真的發生，不必操作假時鐘 */
const SETUP: Partial<MatchConfig> = {
  blueName: '藍',
  redName: '紅',
  totalRounds: 3,
  roundDurationMs: 1_500,
  restDurationMs: 60_000,
}

function renderOperator(): void {
  saveRoom(createRoomConfig({ roomCode: ROOM, judgeMode: 'SINGLE' }), createMatchState(SETUP))
  render(
    <MemoryRouter initialEntries={[`/operator/${ROOM}`]}>
      <Routes>
        <Route path="/operator/:roomCode" element={<OperatorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderSolo(): void {
  saveSoloMatch(createMatchState(SETUP))
  render(
    <MemoryRouter initialEntries={['/solo']}>
      <SoloPage />
    </MemoryRouter>,
  )
}

/**
 * 開賽 → 藍方得 3 分 → 等回合時間到。
 *
 * 一定要先得分：0:0 且無任何事件的回合是「完全平手」，
 * 依設計會轉為 PAUSED 並等待教練優勢判定，而不是進入休息。
 */
async function scoreThenWaitForRoundEnd(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '開始' }))
  expect(screen.getAllByText('比賽進行中').length).toBeGreaterThan(0)
  await user.click(screen.getByLabelText('藍方 頭部踢擊 得 3 分'))

  await waitFor(() => expect(screen.getAllByText('休息中').length).toBeGreaterThan(0), {
    timeout: 8_000,
    interval: 100,
  })
  expect(screen.queryByText('比賽進行中')).not.toBeInTheDocument()
}

describe('黃金｜單機與房間模式行為一致', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('房間模式：回合時間到會自動結算並進入休息', { timeout: 20_000 }, async () => {
    const user = userEvent.setup()
    renderOperator()
    await scoreThenWaitForRoundEnd(user)
  })

  it('單機模式：回合時間到會自動結算並進入休息', { timeout: 20_000 }, async () => {
    const user = userEvent.setup()
    renderSolo()
    await scoreThenWaitForRoundEnd(user)
  })
})
