import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { SoloPage } from './SoloPage'

function renderSolo(initialEntry = '/solo'): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SoloPage />
    </MemoryRouter>,
  )
}

const blueScore = (): string => screen.getByLabelText('藍方分數').textContent ?? ''
const redScore = (): string => screen.getByLabelText('紅方分數').textContent ?? ''
const scoreBtn = (label: string): HTMLElement => screen.getByLabelText(label)

async function start(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '開始' }))
}

async function openMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: '選單' }))
  return screen.getByRole('dialog', { name: '選單' })
}

describe('單機計分頁：計分', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('尚未開始時計分會被拒絕，按下開始後才能計分', async () => {
    const user = userEvent.setup()
    renderSolo()

    await user.click(scoreBtn('藍方 頭部踢擊 得 3 分'))
    expect(blueScore()).toBe('0')
    expect(await screen.findByRole('alert')).toHaveTextContent('請先按「開始」')

    await start(user)
    await user.click(scoreBtn('藍方 頭部踢擊 得 3 分'))
    expect(blueScore()).toBe('3')
  })

  it('藍紅雙方五種技術分值皆正確，且按鈕配置完全一致', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)

    const cases = [
      ['身體正拳', 1],
      ['身體踢擊', 2],
      ['頭部踢擊', 3],
      ['旋轉身體', 4],
      ['旋轉頭部', 6],
    ] as const

    // 藍紅交替加分，避免觸發「分差 15 分提前結束回合」而影響驗證
    for (const [label, points] of cases) {
      expect(scoreBtn(`藍方 ${label} 得 ${points} 分`)).toBeInTheDocument()
      expect(scoreBtn(`紅方 ${label} 得 ${points} 分`)).toBeInTheDocument()

      const blueBefore = Number(blueScore())
      await user.click(scoreBtn(`藍方 ${label} 得 ${points} 分`))
      expect(Number(blueScore())).toBe(blueBefore + points)

      const redBefore = Number(redScore())
      await user.click(scoreBtn(`紅方 ${label} 得 ${points} 分`))
      expect(Number(redScore())).toBe(redBefore + points)
    }
    expect(blueScore()).toBe('16')
    expect(redScore()).toBe('16')
  })

  it('每一方都有 GJ 違規鍵，且分數加給對手', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)

    await user.click(scoreBtn('藍方違規，紅方加 1 分'))
    expect(redScore()).toBe('1')
    expect(blueScore()).toBe('0')

    await user.click(scoreBtn('紅方違規，藍方加 1 分'))
    expect(blueScore()).toBe('1')
  })

  it('分數不會低於 0（復原到底之後仍為 0）', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)
    await user.click(scoreBtn('藍方 身體正拳 得 1 分'))
    await user.click(screen.getByRole('button', { name: /復原 藍方/ }))
    expect(blueScore()).toBe('0')
  })
})

describe('單機計分頁：版面穩定性（不得因狀態改變位移）', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('最後 10 秒違規鍵從一開始就存在，只是 disabled，不會突然出現', async () => {
    const user = userEvent.setup()
    renderSolo()

    const blueSpecial = scoreBtn('藍方最後 10 秒消極違規，紅方加 2 分')
    const redSpecial = scoreBtn('紅方最後 10 秒消極違規，藍方加 2 分')
    expect(blueSpecial).toBeDisabled()
    expect(redSpecial).toBeDisabled()

    await start(user)
    // 開始比賽後仍然存在（尚未進入最後 10 秒，維持 disabled）
    expect(scoreBtn('藍方最後 10 秒消極違規，紅方加 2 分')).toBeDisabled()
  })

  it('操作區按鈕數量固定：每一方 5 顆得分鍵 + GJ + 最後10秒鍵', async () => {
    const user = userEvent.setup()
    renderSolo()
    const countBlue = (): number =>
      screen
        .getAllByRole('button')
        .filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('藍方')).length

    const before = countBlue()
    await start(user)
    await user.click(scoreBtn('藍方 身體踢擊 得 2 分'))
    expect(countBlue()).toBe(before)
  })
})

describe('單機計分頁：修正與復原', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('復原按鈕會顯示即將復原的事件，沒有紀錄時停用', async () => {
    const user = userEvent.setup()
    renderSolo()
    expect(screen.getByRole('button', { name: '沒有可復原的紀錄' })).toBeDisabled()

    await start(user)
    await user.click(scoreBtn('藍方 頭部踢擊 得 3 分'))
    expect(screen.getByRole('button', { name: '復原 藍方 頭部踢擊 +3' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '復原 藍方 頭部踢擊 +3' }))
    expect(blueScore()).toBe('0')
  })

  it('計分後顯示「已記錄」提示，並可直接從提示復原', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)
    await user.click(scoreBtn('紅方 身體踢擊 得 2 分'))

    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('已記錄：紅方 身體踢擊 +2')
    await user.click(within(toast).getByRole('button', { name: '復原' }))
    expect(redScore()).toBe('0')
  })

  it('扣分修正是單次模式：扣一次後自動退出', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)
    await user.click(scoreBtn('藍方 頭部踢擊 得 3 分'))
    expect(blueScore()).toBe('3')

    await user.click(screen.getByRole('button', { name: '扣分修正' }))
    // 修正模式必須有明顯狀態提示
    expect(screen.getByText('修正模式：請選擇要扣除的分數')).toBeInTheDocument()
    expect(scoreBtn('藍方 頭部踢擊 扣除 3 分')).toBeInTheDocument()

    await user.click(scoreBtn('藍方 頭部踢擊 扣除 3 分'))
    expect(blueScore()).toBe('0')
    // 自動退出：按鈕標籤變回「得分」，提示消失
    expect(screen.queryByText('修正模式：請選擇要扣除的分數')).toBeNull()
    expect(scoreBtn('藍方 頭部踢擊 得 3 分')).toBeInTheDocument()
  })

  it('修正模式可手動取消，且修正動作會留下可復原的紀錄', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)
    await user.click(screen.getByRole('button', { name: '扣分修正' }))
    await user.click(screen.getByRole('button', { name: '取消修正' }))
    expect(screen.queryByText('修正模式：請選擇要扣除的分數')).toBeNull()

    await user.click(scoreBtn('藍方 身體踢擊 得 2 分'))
    await user.click(screen.getByRole('button', { name: '扣分修正' }))
    await user.click(scoreBtn('藍方 身體踢擊 扣除 2 分'))
    expect(blueScore()).toBe('0')
    expect(screen.getByRole('button', { name: /復原 藍方 手動修正/ })).toBeInTheDocument()
  })
})

describe('單機計分頁：危險操作防護', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('結束本回合是長按，單擊不會生效', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)
    await user.click(scoreBtn('藍方 身體踢擊 得 2 分'))

    await user.click(screen.getByRole('button', { name: '長按結束本回合' }))
    // 單擊不得結束回合：仍在第 1 回合、分數保留
    expect(blueScore()).toBe('2')
    expect(screen.queryByText(/第 1 回合結束/)).toBeNull()
  })

  it('重新開賽使用自訂確認對話框，取消後不會清除比分', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)
    await user.click(scoreBtn('藍方 身體踢擊 得 2 分'))

    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('button', { name: '重新開賽（清除比分）' }))

    const dialog = screen.getByRole('dialog', { name: '重新開賽？' })
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(blueScore()).toBe('2')
  })

  it('確認重新開賽後比分歸零', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)
    await user.click(scoreBtn('藍方 身體踢擊 得 2 分'))

    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('button', { name: '重新開賽（清除比分）' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '重新開賽？' })).getByRole('button', {
        name: '確定',
      }),
    )
    expect(blueScore()).toBe('0')
  })

  it('比賽結束後所有計分按鈕停用', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)

    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('button', { name: '結束比賽' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '結束比賽？' })).getByRole('button', {
        name: '確定',
      }),
    )

    expect(scoreBtn('藍方 身體踢擊 得 2 分')).toBeDisabled()
    expect(scoreBtn('紅方 旋轉頭部 得 6 分')).toBeDisabled()
    expect(scoreBtn('藍方違規，紅方加 1 分')).toBeDisabled()
  })
})

describe('單機計分頁：開賽流程與資料恢復', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('?setup=1 進入設定新比賽，可設定姓名後直接開賽', async () => {
    const user = userEvent.setup()
    renderSolo('/solo?setup=1')

    const blueInput = screen.getByLabelText('藍方姓名', { selector: 'input' })
    await user.clear(blueInput)
    await user.type(blueInput, '王小明')
    await user.click(screen.getByRole('button', { name: '90 秒｜訓練賽' }))
    await user.click(screen.getByRole('button', { name: '開始比賽' }))

    expect(screen.getByText('王小明')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '開始' })).toBeInTheDocument()
  })

  it('比賽設定會被記住，下次開啟設定頁時沿用', async () => {
    const user = userEvent.setup()
    renderSolo('/solo?setup=1')
    const redInput = screen.getByLabelText('紅方姓名', { selector: 'input' })
    await user.clear(redInput)
    await user.type(redInput, '李大同')
    await user.click(screen.getByRole('button', { name: '開始比賽' }))
    cleanup()

    renderSolo('/solo?setup=1')
    expect(screen.getByLabelText('紅方姓名', { selector: 'input' })).toHaveValue('李大同')
  })

  it('重新整理後恢復比賽，並提供「繼續比賽」與「放棄並重新開始」', async () => {
    const user = userEvent.setup()
    renderSolo()
    await start(user)
    await user.click(scoreBtn('藍方 身體正拳 得 1 分'))
    expect(blueScore()).toBe('1')

    cleanup()
    renderSolo()
    expect(blueScore()).toBe('1')
    expect(screen.getByText('已恢復上一場比賽')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '繼續比賽' }))
    expect(screen.queryByText('已恢復上一場比賽')).toBeNull()
    expect(blueScore()).toBe('1')
  })

  it('本機資料損毀時不會白畫面，改以全新比賽啟動', () => {
    window.localStorage.setItem('tp-tkd-score-lite:solo:v1', '{ 這不是合法的 JSON')
    window.localStorage.setItem('tp-tkd-score-lite:prefs:v1', 'oops')
    renderSolo()
    expect(blueScore()).toBe('0')
    expect(screen.getByRole('button', { name: '開始' })).toBeInTheDocument()
  })

  it('音效與震動開關可切換並保存', async () => {
    const user = userEvent.setup()
    renderSolo()
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('button', { name: '音效：開' }))
    expect(within(menu).getByRole('button', { name: '音效：關' })).toBeInTheDocument()

    cleanup()
    renderSolo()
    const menu2 = await openMenu(user)
    expect(within(menu2).getByRole('button', { name: '音效：關' })).toBeInTheDocument()
  })
})
