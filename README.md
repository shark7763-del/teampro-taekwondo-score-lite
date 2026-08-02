# TeamPro Taekwondo Score Lite ／ TeamPro 跆拳道簡易計分系統

適合學校校隊、道館訓練賽與小型友誼賽的跆拳道計分系統。
一台手機就能計分並鏡射到電視；也可以電視獨立顯示、兩台裁判手機共同確認得分。

> ## ⚠️ 重要聲明
> **本系統供訓練賽及模擬賽使用，非 WT 認證競賽設備。**
> 不可用於正式競賽的成績認定，亦不等同於 WT 認證的電子護具（PSS）系統。

---

## 🔗 線上版

**https://shark7763-del.github.io/teampro-taekwondo-score-lite/**

- 手機開啟後可「加入主畫面」，即為 App 般的使用體驗。
- 路由使用 hash 形式（例如 `.../#/solo`），確保從 QR Code 開啟或重新整理都不會 404。
- Repo：`shark7763-del/teampro-taekwondo-score-lite`（public）
- 更新方式：`git push` 到 `main` → GitHub Actions 會先跑
  typecheck / lint / test / build，**全部通過才會部署**。

## 目前狀態

| 階段 | 內容 | 狀態 |
|---|---|---|
| 1 | 規則引擎、計時器、比賽狀態機、**單機模式 `/solo`**、大型計分板 | ✅ 完成，可實際使用 |
| 2 | 建立比賽、六碼房間、QR Code、電視顯示端（mock） | ⬜ 開發中 |
| 3 | Supabase migration / RLS / `submit_judge_press` RPC | ⬜ 未開始 |
| 4 | 主控端、裁判端、Realtime、Presence | ⬜ 未開始 |
| 5 | PWA 離線、E2E、部署 | ⬜ 未開始 |

詳細進度與手動測試步驟見 [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)。

---

## 本機執行

```bash
cd D:\TeamPro跆拳道簡易計分系統
npm install
npm run dev          # http://localhost:5173
```

其他指令：

```bash
npm run typecheck    # TypeScript 嚴格模式檢查
npm run lint         # ESLint
npm run test         # Vitest（54 條）
npm run build        # 產出 dist/
npm run preview      # 預覽 build 結果
```

`npm run dev` 已開啟 `host: true`，同一個 Wi-Fi 下的電視／平板／裁判手機
可用 `http://<你的電腦IP>:5173` 連入測試。

---

## 計分規則（WT Competition Rules 2026-06-01，訓練用）

### 賽制：三回合兩勝制

- **每一回合分數歸零重新計算**，不是整場累加。
- 先贏得 **2 個回合**者獲勝 → **2:0 領先時不會進行第三回合**。
- 回合平手時，依序判定：
  1. 旋轉技術得分較多者勝
  2. 高分值技術數量較多者勝（3 分 → 2 分 → 1 分）
  3. Gam-jeom 較少者勝
  4. 仍相同 → 由主控（正式賽為主審）**依優勢判定**，系統不自行猜測
- 單一回合累積 **5 次 Gam-jeom** → 該回合直接判給對手。
- 單一回合分差達 **15 分**（2026 由 12 調整）→ 該回合提前結束。

> ⚠️ 正式賽在「高分值技術數量」與「Gam-jeom 較少」之間，另有一項
> 「PSS 登錄擊中次數」。本系統為無電子護具模式，無此資料，故略過該項。

### 分值

| 技術 | 分數 |
|---|---|
| 身體有效正拳 | 1 |
| 身體有效踢擊 | 2 |
| 頭部有效踢擊 | 3 |
| 身體有效旋轉踢擊 | 4（＝身體踢擊 × 2） |
| 頭部有效旋轉踢擊 | 6（＝頭部踢擊 × 2） |
| 一般 Gam-jeom | 對手 +1 |
| 回合最後 10 秒消極行為之 Gam-jeom | 對手 **+2**，且只記 **1 次** Gam-jeom |

- 2026 規則將旋轉技術由舊制「+2」改為「**基本分的兩倍**」，本系統以
  `基本分 × turningMultiplier` 推導，不在程式中寫死 4 與 6。
- 最後 10 秒加重處罰適用於**出界、倒地、逃避對手**三種消極行為，
  且**不會**再另外加一般 Gam-jeom 的 1 分。
- 分值集中定義於 `src/rules/ruleSets.ts`，任何元件都不得自行寫死分數。

### 哪些是官方規則，哪些是本系統自訂

| 項目 | 性質 |
|---|---|
| 1 / 2 / 3 / 4 / 6 分值、Gam-jeom 對手加分、最後 10 秒加重 | World Taekwondo 規則（**來源為公開整理資料，尚待官方 PDF 逐條核對**） |
| 「兩位裁判在時間窗內按下相同選手、相同技術才成立」 | **本系統的訓練設定**。概念取自正式賽多裁判多數決，但 2 人制為本系統簡化 |
| 確認時間窗（預設 1000 毫秒，可選 600–2000） | **本系統的訓練操作參數，World Taekwondo 並無此秒數規定** |
| 同技術 400 毫秒防誤觸冷卻、每秒 3 次送出上限 | 本系統的防呆設計 |

程式中以 `officialSourceVerified: false` 標記，畫面顯示「（待官方核對）」。

---

## 三種使用情境

### 1. 一台手機鏡射電視（現在就可用，且可離線）

1. 首頁 →「單手機計分」。
2. 用 HDMI 線或 AirPlay／Chromecast 把手機畫面投到電視。
3. 點右上「鏡射模式」→ 操作面板隱藏、自動全螢幕，電視只看到大型計分板。
4. 需要操作時點畫面最下方長條即可叫回操作面板。

### 2. 手機主控 ＋ 電視獨立顯示（階段 2）

電視開 `/display/<六碼房間代碼>`，手機留在 `/operator/<六碼房間代碼>`。

### 3. 兩台裁判手機 ＋ 一台電視（階段 3–4）

裁判 A 開 `/judge/<房間代碼>/A`、裁判 B 開 `/judge/<房間代碼>/B`，
兩人在確認時間窗內按下**相同選手、相同技術**，伺服器才正式加分一次。

---

## 專案結構

```
src/
├─ types/          共用型別（含 PSS、三裁判預留欄位）
├─ rules/          規則集與規則引擎（唯一分值來源）+ 測試
├─ timer/          計時器純函式 + 測試
├─ match/          比賽狀態機（單機與伺服器共用判斷）+ 測試
├─ storage/        單機模式 localStorage 保存
├─ hooks/          useNow / useSoloMatch / useFullscreen / useWakeLock
├─ lib/            震動與 WebAudio 提示音
├─ components/     Scoreboard（大型計分板）、ScoreButtons、ui
└─ pages/          HomePage、SoloPage、階段 2–4 頁面占位
```

---

## 安全假設（設計原則，隨階段 3 實作）

1. **六碼房間代碼不是管理權限**，只提供觀看；任何寫入都需要 token。
2. 主控端以 **PIN → 伺服器 RPC 驗證 → 短期 token**，PIN 以 pgcrypto 雜湊儲存，
   **不在前端比對、不存明碼**。
3. 裁判 A 與 B 使用**不同的 join token**，一個席位同時只有一個啟用裝置。
4. **前端不能直接修改正式比分**：`matches.blue_score / red_score` 只能由 RPC 在交易內更新。
5. `submit_judge_press` 於交易第一行取得 advisory lock，
   確保兩台手機**完全同時送出也只加一次分**。
6. `client_event_id` 為 UNIQUE，**重送不會重複計分**。
7. 啟用 Supabase RLS；anon 角色不得 UPDATE 任何比分欄位。
8. **前端只使用 anon key**；service role key 絕不可進入前端或 `VITE_` 變數。
9. 房間有 `expires_at`（預設 4 小時），過期後拒絕所有新操作。
10. 裁判按鍵 RPC 具備 rate limit（每裝置每秒 3 次）與 400 毫秒同技術冷卻。

---

## 環境變數

複製 `.env.example` 為 `.env`：

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

未設定時系統自動使用 mock adapter，**單機模式 `/solo` 完全不受影響**。

---

## 已知限制

- 階段 1 僅單機模式可實際使用；多人房間、雙裁判、Realtime 尚未完成。
- 單機模式資料存在該台手機的 localStorage，換手機不會同步。
- 規則分值來源為公開整理資料，**尚未逐條比對 WT 官方 PDF**。
- PSS 模擬模式與三裁判 2/3 確認僅保留資料結構與規則，未提供 UI。
- 鏡射模式依賴手機本身的投影能力（HDMI／AirPlay／Chromecast）。

## 未來擴充

PSS 模擬模式 UI、三裁判 2/3 確認、賽事紀錄匯出、與 TeamPro 其他系統的選手資料串接、影像回放標記。
