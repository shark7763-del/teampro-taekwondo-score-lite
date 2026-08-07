import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { OperatorPage } from './RoomPages'
import { createMatchState } from '../match/matchCore'
import { createRoomConfig, saveRoom } from '../room/roomStorage'

/**
 * 回歸測試：主控端的「扣分修正」。
 *
 * 現場回報「按修正扣分沒有反應」。原因有兩個，都在主控端：
 * 1. onScore 不管在不在修正模式都送 SCORE —— 按「−3」其實是加 3 分，
 *    而休息中／未開始時 SCORE 會被規則擋掉，就變成完全沒反應。
 * 2. 主控端沒有任何拒絕提示（單機模式有 toast），被擋掉時畫面完全靜默。
 */

const ROOM = 'FIXBUG'

function renderOperator(): void {
  saveRoom(
    createRoomConfig({ roomCode: ROOM, judgeMode: 'SINGLE' }),
    createMatchState({ blueName: '藍', redName: '紅', roundDurationMs: 120_000 }),
  )
  render(
    <MemoryRouter initialEntries={[`/operator/${ROOM}`]}>
      <Routes>
        <Route path="/operator/:roomCode" element={<OperatorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const blueScore = (): string => screen.getByLabelText('藍方分數').textContent ?? ''

describe('主控端｜扣分修正', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('修正模式下按技術鍵是扣分，不是加分', async () => {
    const user = userEvent.setup()
    renderOperator()

    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByLabelText('藍方 頭部踢擊 得 3 分'))
    await user.click(screen.getByLabelText('藍方 身體踢擊 得 2 分'))
    expect(blueScore()).toBe('5')

    await user.click(screen.getByRole('button', { name: '扣分修正' }))
    await user.click(screen.getByLabelText('藍方 頭部踢擊 扣除 3 分'))

    await waitFor(() => expect(blueScore()).toBe('2'))
  })

  it('扣一次就自動退出修正模式，避免教練忘記自己還在扣分', async () => {
    const user = userEvent.setup()
    renderOperator()

    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByLabelText('藍方 頭部踢擊 得 3 分'))
    await user.click(screen.getByRole('button', { name: '扣分修正' }))
    await user.click(screen.getByLabelText('藍方 身體正拳 扣除 1 分'))

    await waitFor(() => expect(blueScore()).toBe('2'))
    // 已退出修正模式：按鈕文字回到「扣分修正」，再按技術鍵是加分
    expect(screen.getByRole('button', { name: '扣分修正' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('藍方 身體正拳 得 1 分'))
    await waitFor(() => expect(blueScore()).toBe('3'))
  })

  it('扣到負分會被拒絕，而且要明確告訴使用者原因', async () => {
    const user = userEvent.setup()
    renderOperator()

    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByLabelText('藍方 身體正拳 得 1 分'))
    expect(blueScore()).toBe('1')

    await user.click(screen.getByRole('button', { name: '扣分修正' }))
    await user.click(screen.getByLabelText('藍方 頭部踢擊 扣除 3 分'))

    // 分數不變，而且畫面必須說明為什麼——不能只是沒反應
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('負分'))
    expect(blueScore()).toBe('1')
  })

  it('尚未開始就計分會被拒絕，並顯示原因', async () => {
    const user = userEvent.setup()
    renderOperator()

    await user.click(screen.getByLabelText('藍方 頭部踢擊 得 3 分'))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('請先按'))
    expect(blueScore()).toBe('0')
  })
})
