import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { DisplayPage, OperatorPage } from './RoomPages'

/**
 * 多裝置流程的整合測試。
 *
 * jsdom 內無法連 Supabase，因此走的是「本機退路」傳輸（BroadcastChannel），
 * 但主控端與電視端之間的責任分工、訊息格式與畫面切換完全相同：
 * 主控端算分並廣播 → 電視端只顯示收到的正式狀態。
 */

const ROOM = 'ABCDEF'

function renderTvAndOperator(): void {
  render(
    <>
      <MemoryRouter initialEntries={[`/operator/${ROOM}`]}>
        <Routes>
          <Route path="/operator/:roomCode" element={<OperatorPage />} />
        </Routes>
      </MemoryRouter>
      <MemoryRouter initialEntries={[`/display/${ROOM}`]}>
        <Routes>
          <Route path="/display/:roomCode" element={<DisplayPage />} />
        </Routes>
      </MemoryRouter>
    </>,
  )
}

/** 電視端與主控端各有一塊計分板，取最後一塊即為電視端 */
function tvBlueScore(): string {
  const boards = screen.getAllByLabelText('藍方分數')
  return boards[boards.length - 1]?.textContent ?? ''
}

describe('電視顯示端 ＋ 手機主控端', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('主控端尚未建立比賽時，電視顯示房間代碼等待連線', () => {
    renderTvAndOperator()
    // 主控端與電視端都會顯示房間代碼
    expect(screen.getAllByText(ROOM).length).toBeGreaterThan(0)
    expect(screen.getByText('用手機掃我開始計分')).toBeInTheDocument()
    // 還沒有任何比分可以顯示
    expect(screen.queryByLabelText('藍方分數')).not.toBeInTheDocument()
  })

  it('主控端開賽後電視自動切換成計分板，計分會同步過去', async () => {
    const user = userEvent.setup()
    renderTvAndOperator()

    await user.click(screen.getByRole('button', { name: '開始比賽' }))
    await waitFor(() => expect(screen.getAllByLabelText('藍方分數').length).toBe(2))
    expect(tvBlueScore()).toBe('0')

    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByLabelText('藍方 頭部踢擊 得 3 分'))

    await waitFor(() => expect(tvBlueScore()).toBe('3'))
  })

  it('電視端不提供任何計分操作', async () => {
    const user = userEvent.setup()
    renderTvAndOperator()
    await user.click(screen.getByRole('button', { name: '開始比賽' }))
    await waitFor(() => expect(screen.getAllByLabelText('藍方分數').length).toBe(2))

    // 得分按鈕只有主控端有，電視端沒有第二顆
    expect(screen.getAllByLabelText('藍方 頭部踢擊 得 3 分')).toHaveLength(1)
  })
})
