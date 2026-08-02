import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { SoloPage } from './SoloPage'

function renderSolo(): void {
  render(
    <MemoryRouter>
      <SoloPage />
    </MemoryRouter>,
  )
}

function blueScore(): string {
  return screen.getByLabelText('藍方分數').textContent ?? ''
}

function redScore(): string {
  return screen.getByLabelText('紅方分數').textContent ?? ''
}

describe('單機計分頁', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('尚未開始時計分會被拒絕，按下開始後才能計分', async () => {
    const user = userEvent.setup()
    renderSolo()

    await user.click(screen.getByLabelText('藍方 頭部踢擊 加 3 分'))
    expect(blueScore()).toBe('0')
    expect(await screen.findByRole('status')).toHaveTextContent('請先按「開始」')

    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByLabelText('藍方 頭部踢擊 加 3 分'))
    expect(blueScore()).toBe('3')
  })

  it('旋轉頭部踢擊為 6 分，且分數由規則引擎決定', async () => {
    const user = userEvent.setup()
    renderSolo()
    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByLabelText('紅方 旋轉頭部 加 6 分'))
    expect(redScore()).toBe('6')
  })

  it('Gam-jeom 的分數加給對手：藍方違規時紅方 +1', async () => {
    const user = userEvent.setup()
    renderSolo()
    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByRole('button', { name: '藍方違規，紅方 +1' }))
    expect(redScore()).toBe('1')
    expect(blueScore()).toBe('0')
  })

  it('復原會回復分數，且紀錄中保留原事件', async () => {
    const user = userEvent.setup()
    renderSolo()
    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByLabelText('藍方 身體踢擊 加 2 分'))
    expect(blueScore()).toBe('2')

    await user.click(screen.getByRole('button', { name: '復原' }))
    expect(blueScore()).toBe('0')

    await user.click(screen.getByRole('button', { name: '紀錄' }))
    const drawer = screen.getByRole('heading', { name: /得分紀錄/ }).parentElement?.parentElement
    expect(drawer).toBeTruthy()
    // 原始事件 + 復原事件都必須保留（不得刪除紀錄）
    const entries = within(drawer as HTMLElement).getAllByText(/藍方 身體踢擊 \+2/)
    expect(entries).toHaveLength(2)
    expect(within(drawer as HTMLElement).getByText(/復原：藍方 身體踢擊 \+2/)).toBeInTheDocument()
  })

  it('比賽結束後所有計分按鈕停用', async () => {
    const user = userEvent.setup()
    renderSolo()
    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByRole('button', { name: '設定' }))
    await user.click(screen.getByRole('button', { name: '結束比賽' }))
    await user.click(screen.getByRole('button', { name: '關閉' }))

    expect(screen.getByLabelText('藍方 身體踢擊 加 2 分')).toBeDisabled()
    expect(screen.getByLabelText('紅方 旋轉頭部 加 6 分')).toBeDisabled()
  })

  it('最後 10 秒特殊 Gam-jeom 按鈕平時不出現', () => {
    renderSolo()
    expect(screen.queryByRole('button', { name: /最後10秒消極/ })).toBeNull()
  })

  it('分數會保存在本機，重新掛載後仍在（離線可用）', async () => {
    const user = userEvent.setup()
    renderSolo()
    await user.click(screen.getByRole('button', { name: '開始' }))
    await user.click(screen.getByLabelText('藍方 身體正拳 加 1 分'))
    expect(blueScore()).toBe('1')

    cleanup()
    renderSolo()
    expect(blueScore()).toBe('1')
  })
})
