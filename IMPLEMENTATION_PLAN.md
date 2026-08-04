# IMPLEMENTATION_PLAN.md

**專案**：TeamPro Taekwondo Score Lite ／ TeamPro 跆拳道簡易計分系統
**路徑**：`D:\TeamPro跆拳道簡易計分系統\`
**最後更新**：2026-08-05（階段 2–3 完成：真正的跨裝置連線）

> ⚠️ 本系統供訓練賽及模擬賽使用，非 WT 認證競賽設備。

---

## 0. 開發前檢查結果

| 檢查項目 | 結果 |
|---|---|
| 目前資料夾 | `D:\` 下無同名專案，本專案為**新建**資料夾 |
| 既有相關專案 | `D:\跆拳道手機對打計分系統\index.html`（Firebase 三機版，32.5 KB）**完全未更動** |
| 其他可借鏡 | `D:\teampro-reaction-tv\`（房間碼＋QR＋Server 統一時鐘）、`D:\TeamPro體測系統\` |
| Node / npm | v24.18.0 / 11.16.0 |
| 相依安全性 | `npm audit` = **0 vulnerabilities**（react-router 採 8.3.0，避開 7.12–8.2 的 RSC CSRF 公告） |
| `.env` 保護 | `.gitignore` 已加入 `.env` / `.env.*`（保留 `.env.example`） |
| service role key | 前端僅使用 `VITE_SUPABASE_ANON_KEY`，`.env.example` 明文警告禁止放 service role key |

---

## 1. 架構決策（來自驗算結論，P0 已全部納入設計）

| 決策 | 內容 |
|---|---|
| 分值來源 | 集中於 `src/rules/ruleSets.ts` + `ruleEngine.ts`，元件禁止出現 1/2/3/4/6 魔術數字 |
| **賽制** | **三回合兩勝制：每回合分數歸零，先贏 2 回合獲勝，2:0 時不打第三回合**。平手依「旋轉分 → 高分值技術數 → **教練優勢判定**」（`tieBreakUsesGamjeomCount=false`，正式賽的 Gam-jeom 比較項預設關閉）；回合 5 次 Gam-jeom 或分差 15 分提前結束 |
| 旋轉技術 | **基本分 × turningMultiplier(2)**，不寫死 4 與 6（2026 倍數制） |
| PSS 追加分 | 由倍數推導：身體 +2、頭部 **+3**（修正原規格「一律 +2」的錯誤） |
| 事件模型 | 只新增事件、永不刪除；復原＝REVERSAL 事件；同一事件只能復原一次 |
| 分數計算 | `computeScores(events)` 由事件列表重算，斷線重連一律覆蓋本機 |
| 計時器 | 只存 `timerStartedAt + remainingMsAtStart + timerStatus`，各端以**時間差重算**；禁止遞減式 setInterval |
| 冷卻 | 只有「被受理」的按鍵才進入 400ms 冷卻，被拒絕的按鍵不鎖住下一次操作 |
| 版位 | 藍左紅右固定，交換只換姓名不換版位 |

---

## 2. 階段進度

### ✅ 階段 1：可操作 UI（已完成）

**已完成**

- [x] 專案骨架：React 19 + TS(strict) + Vite 8 + Tailwind 4 + React Router 8
- [x] 品質工具：ESLint 10（`no-explicit-any: error`）+ Prettier + Vitest 4 + RTL
- [x] 路由：`/`、`/solo`、`/mirror`、`/join`、`/display`、`/display/:roomCode`、`/operator/:roomCode`、`/judge/:roomCode/:seat`
- [x] 共用型別 `src/types/index.ts`（含 PSS、三裁判 seat C、`required_confirmations` 對應欄位預留）
- [x] 規則引擎 `src/rules/`：分值換算、Gam-jeom 判定、PSS 拆解、事件工廠、復原邏輯
- [x] 計時器 `src/timer/timer.ts`：純函式、時間差重算、`M:SS` 與最後 10 秒 `9.4` 格式
- [x] 比賽狀態機 `src/match/matchCore.ts`：計分／Gam-jeom／復原／手動修正／回合／結束／重開
- [x] 單機模式 `/solo`：計分、計時、Gam-jeom（含最後 10 秒條件式按鈕）、扣分修正、復原、得分紀錄抽屜、設定抽屜、鏡射模式、全螢幕、操作區 3 秒淡出、Wake Lock
- [x] 本機保存 `src/storage/soloStorage.ts`（localStorage，載入時以事件重算分數）
- [x] 震動與 WebAudio 提示音（無外部音檔，離線可用），可關閉
- [x] 大型計分板共用元件（單機鏡射與第二階段電視端使用同一個）
- [x] 首頁：四個入口、規則版本、分值說明、非 WT 認證聲明、PWA 安裝鈕
- [x] 測試 **54 條全綠**：規則 21、計時器 8、狀態機 18、單機頁 RTL 7

### ✅ 階段 1.5：Solo Mode 操作手順優化（2026-08-02 完成）

- [x] 得分鍵改為 **2×3 固定配置**＋GJ，藍紅完全一致，主鍵 ≥64px、其餘 ≥56px
- [x] 響應式：直向（控制列在上、藍紅左右分欄）／橫向與平板（左藍｜中控｜右紅），全 CSS Grid
- [x] 最後 10 秒違規鍵**固定位置**，未達條件為 disabled，**零 layout shift**；進入時提示音＋震動
- [x] 復原按鈕直接顯示待復原事件；計分後 2.6 秒「已記錄：… 復原」提示
- [x] 扣分修正改為**單次模式**（扣一次自動退出、5 秒逾時退出、可取消、回合切換不殘留）
- [x] 結束回合改為**長按 0.9 秒**＋進度條；危險操作改用自訂 ConfirmModal（不再用 window.confirm）
- [x] 快速開賽：首頁「立即開賽」／「設定新比賽」，時間快速選項，設定會被記住
- [x] 回合結束引導面板（本回合比分／勝方／開始休息／跳過休息／修正結果）
- [x] 時間區可點擊開始暫停；狀態文字改為「尚未開始／比賽進行中／已暫停／休息中／比賽結束」
- [x] 資料恢復：「已恢復上一場比賽」＋繼續／放棄；偏好與上次設定獨立保存；損毀資料逐欄回退
- [x] **PWA 完整落地**：manifest／service worker／icons／離線可用／自動更新
- [x] 顯示端與控制端元件分離＋`src/sync` service 層；`#/mirror` 同瀏覽器第二視窗顯示
- [x] a11y：aria-label、focus-visible、prefers-reduced-motion、safe-area、防長按選字、防雙擊縮放
- [x] 同鍵防連點由 400ms 收斂為 **180ms**，不影響高速計分
- [x] 測試 71 → **88 條**

**品質檢查（階段 1 結果）**

```
npm run typecheck  ✅ 0 error
npm run lint       ✅ 0 error / 0 warning
npm run test       ✅ 54 passed (4 files)
npm run build      ✅ 264 KB / gzip 84 KB
```

**手動測試方式**

```bash
cd D:\TeamPro跆拳道簡易計分系統
npm run dev
```

1. 開 `http://localhost:5173/` → 應看到首頁與「非 WT 認證設備」聲明。
2. 點「單手機計分」→ 未按開始就點計分 → 應跳出「請先按開始」且分數不變。
3. 按「開始」→ 點藍方「+6 旋頭」→ 藍方 6 分並有 +6 浮出動畫（<1 秒消失）。
4. 點「藍方違規，紅方 +1」→ **紅方**加 1 分、藍方 Gam-jeom 顯示 1。
5. 等到該回合剩 10 秒內 → 才會出現「最後10秒消極」按鈕；按下後對手 +2、Gam-jeom 只 +1。
6. 點「復原」→ 分數回復；開「紀錄」→ 原事件與復原事件**兩筆都在**。
7. 點「鏡射模式」→ 操作面板消失、進入全螢幕，適合投到電視；點底部長條可回到操作模式。
8. 計時中不要操作 3 秒 → 操作區自動淡出（仍可點，不會吃掉按鍵）。
9. 重新整理頁面 → 分數、回合、剩餘時間都正確（時間以時間差重算）。
10. 關掉 Wi‑Fi／飛航模式 → 單機模式所有功能照常運作。

**跨裝置手動測試（需先設定 `.env` 的 `VITE_SUPABASE_*`）**

1. 電腦（當電視）開首頁 →「📺 這台是電視」→ 應出現六碼代碼與 QR，
   徽章顯示「雲端連線」（若顯示「本機模擬」表示環境變數沒吃到，重開 `npm run dev`）。
2. 手機（**用手機網路，不要連同一個 Wi-Fi**）掃 QR → 進入設定畫面 → 開賽。
3. 電視應在 1 秒內切換成計分板；手機按 +2 → 電視同步跳分。
4. 比對電視與手機的秒數：應完全一致（時鐘校正生效）。
5. 電視點右上「全螢幕」→ 滿版且無捲動。
6. 手機開啟飛航模式 8 秒 → 電視顯示「主控端未連線，顯示最後正式比分」，
   數字停在最後一筆正式比分；關掉飛航模式後應自動恢復同步。
7. 手機重新整理 → 比分、回合、剩餘時間都還在（存在該台手機的 localStorage）。
8. 主控端點「房間 · 連線」→ 切換雙裁判 → 第三支手機掃裁判 A、第四支掃裁判 B；
   只有一位按時顯示「等待另一位裁判確認」且比分不變，兩位按同一技術才加分一次。

---

### ✅ 階段 2：房間、電視端與裁判端（2026-08-05 完成）

- [x] 六碼房間代碼產生 + QR Code
- [x] `/display/:roomCode` 電視端（沿用 `Scoreboard`），含連線狀態列
- [x] `/operator/:roomCode` 主控端、`/judge/:roomCode/:seat` 裁判端
- [x] 配對狀態機純函式 `src/pairing/pairingEngine.ts` + 測試

### ✅ 階段 3：真正的跨裝置連線（2026-08-05 完成）

**採取的路線**：主控端裝置持有比賽狀態，Supabase **Realtime Broadcast** 只負責轉送訊息。
因此不需要建立任何資料表、不需要 migration、不需要 RLS 就能真正跨裝置運作。
代價是主控端關閉即房間結束、主控端不能換裝置接手 —— 這兩點留給階段 4。

- [x] `src/lib/supabaseClient.ts`：未設定環境變數時回傳 null，呼叫端自動退回本機模式
- [x] `src/room/roomChannel.ts`：`cloud`（Supabase Realtime）／`local`（BroadcastChannel）
      兩種傳輸共用同一組介面；未就緒時的送出訊息會排隊（上限 8 則，避免堆積過期狀態）
- [x] `src/room/clock.ts`：跨裝置時鐘校正（每則狀態帶主控端 `sentAt`，接收端平滑估算 offset）
- [x] 主控端心跳（2 秒）：晚加入的電視立刻看到比分、用戶端據此判斷斷線、提供校正樣本
- [x] **流程改為電視開房間**：電視點一下就產生代碼與 QR，手機掃碼成為主控，
      電視上完全不需要打字（原本 `/create` 先在手機建房、電視卻無法掃碼的流程不可用）
- [x] 移除「主控 PIN」：它在前端比對，並非真正的安全機制，留著只會造成誤解
- [x] 三個頁面都誠實顯示目前是「雲端連線」還是「本機模擬（僅同一瀏覽器）」
- [x] `.github/workflows/deploy.yml` 帶入 `VITE_SUPABASE_*` secrets
- [x] 測試 88 → **123 條**（新增：時鐘校正 5、訊息通道 6、電視＋主控整合 3）

### ⬜ 階段 4：Supabase 伺服器端權威

- [ ] migration：`rooms` / `matches` / `devices` / `judge_presses` / `score_events` / `rule_sets`
- [ ] RLS policy（anon 一律不可 UPDATE `matches`；讀取走 security definer RPC）
- [ ] RPC：`create_room`、`join_room`、主控端憑證驗證（**一律在伺服器端**，前端不做比對）
- [ ] RPC：`submit_judge_press`
      — 第一行 `pg_advisory_xact_lock(hashtext(match_id::text))`，全程單一交易
      — `client_event_id` UNIQUE，重送回傳第一次結果
      — 配對條件：不同 seat、相同 side、相同 action、`now() - server_created_at <= window`
      — 多筆候選取**最早一筆**；成立時寫唯一 `matched_group_id`，只加分一次
- [ ] RPC：`apply_gamjeom`（後端再次驗證剩餘時間 ≤ 10s）、`reverse_event`（`reversed_event_id` UNIQUE）、`advance_round(expected_round)`
- [ ] DB 併發測試 3 條（同時送出、重送、同 seat 連按）

- [ ] 主控端改為向資料庫送命令，**主控端關閉或換裝置後可由另一台接手**
- [ ] Realtime：DB Change（正式）＋ Presence（在線）＋ Broadcast（僅動畫）
- [ ] 重連流程：refetch `matches` → 覆蓋本機 → 顯示「已重新同步」
- [ ] 離線／逾時三態：送出中 / 已成立 / 未知（可用同 id 重送），**禁止樂觀顯示成立**
- [ ] 偵測「同一房間有兩個主控端」並明確提示（目前會互相覆蓋）

### ⬜ 階段 5：品質

- [x] `vite-plugin-pwa`：離線可開、`/solo` 完全離線可用
- [x] README 完整化（Supabase 設定、部署、手機加入主畫面、雙裁判測試方式）
- [x] 部署（GitHub Pages + HashRouter）
- [ ] Playwright E2E 4 條

---

## 3. 第一版明確不做

選手資料庫、賽程表、淘汰表、帳號系統、真實電子護具串接、PSS 模擬模式 UI、三裁判 UI、影像回放。
（PSS 與三裁判的**資料結構與規則**已保留，第二版只需補 UI 與 RPC 參數。）

---

## 4. 待官方核對的規則項目

1. 旋轉頭部踢擊 6 分是否適用所有量級與青少年組。
2. 「最後 10 秒消極行為」的官方明確定義清單。
3. 2026-01-01 版與 2026-06-01 版（羅馬 GP1 起適用）的差異是否影響本系統。
4. 15 分差終止是否納入訓練模式。

目前規則來源為公開整理資料，`rule_sets.officialSourceVerified = false`，畫面上以「（待官方核對）」標示。
