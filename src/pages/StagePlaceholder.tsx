import { Link, useParams } from 'react-router'
import { NonCertifiedNotice, Panel } from '../components/ui'

interface PlaceholderProps {
  title: string
  stage: string
  bullets: string[]
}

/**
 * 第二～四階段的頁面占位。
 * 目的：路由與資訊架構先固定下來，避免之後大改；同時清楚告知目前進度，
 * 不做出「看起來會動其實沒作用」的假介面。
 */
export function StagePlaceholder({ title, stage, bullets }: PlaceholderProps): React.ReactElement {
  const params = useParams()
  const roomCode = typeof params.roomCode === 'string' ? params.roomCode : null

  return (
    <div className="safe-area mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 p-4">
      <Link to="/" className="text-sm font-bold text-slate-400">
        ← 回首頁
      </Link>
      <h1 className="text-2xl font-black">{title}</h1>
      {roomCode !== null && (
        <p className="text-sm text-slate-400">
          房間代碼：<b className="tabular text-lg text-white">{roomCode.toUpperCase()}</b>
        </p>
      )}

      <Panel title={`目前進度：${stage}`}>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-slate-300">
          {bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-emerald-300">
          現在就可以使用的是{' '}
          <Link to="/solo" className="underline">
            單手機計分
          </Link>
          ，其功能完整且可離線運作。
        </p>
      </Panel>

      <NonCertifiedNotice />
    </div>
  )
}

export function CreatePage(): React.ReactElement {
  return (
    <StagePlaceholder
      title="建立多人比賽"
      stage="第二階段開發中"
      bullets={[
        '六碼房間代碼與 QR Code（電視／主控／裁判 A／裁判 B 各一組）',
        '單裁判或雙裁判、回合數、每回合時間、確認時間窗等設定',
        '主控 PIN：由伺服器端 RPC 驗證，前端不做比對，也不儲存明碼',
      ]}
    />
  )
}

export function JoinPage(): React.ReactElement {
  return (
    <StagePlaceholder
      title="加入比賽"
      stage="第二階段開發中"
      bullets={['輸入六碼房間代碼加入電視顯示端', '房間代碼只提供觀看權限，操作權限一律需要 token']}
    />
  )
}

export function DisplayPage(): React.ReactElement {
  return (
    <StagePlaceholder
      title="電視顯示端"
      stage="第二階段開發中"
      bullets={[
        '大型計分板（已完成共用元件，單機鏡射模式即為同一畫面）',
        '裁判在線狀態、網路狀態、規則版本',
        '斷線時保留最後正式比分並顯示「連線中斷」，重連後重新抓取伺服器狀態',
      ]}
    />
  )
}

export function OperatorPage(): React.ReactElement {
  return (
    <StagePlaceholder
      title="主控端"
      stage="第四階段開發中"
      bullets={[
        '計時控制、回合切換、Gam-jeom、復原、手動修正、得分紀錄',
        'Gam-jeom 文字一律寫成「藍方違規，紅方 +1」，避免操作者誤解',
        '最後 10 秒特殊處罰按鈕只在條件成立時可用，且後端會再次驗證',
      ]}
    />
  )
}

export function JudgePage(): React.ReactElement {
  return (
    <StagePlaceholder
      title="裁判端"
      stage="第三階段開發中"
      bullets={[
        '五顆計分按鈕（已完成共用元件）',
        '按下顯示「等待另一位裁判確認」，不立即改變正式總分',
        '配對成功由伺服器 submit_judge_press RPC 判定，同一位裁判連按兩次不得自行成立',
        '不顯示另一位裁判按了哪一方或哪一種技術，避免互相影響',
      ]}
    />
  )
}
