# IMPLEMENTATION_PLAN.md

**專案**：TeamPro Taekwondo Score Lite ／ TeamPro 跆拳道簡易計分系統
**路徑**：`D:\TeamPro跆拳道簡易計分系統\`
**最後更新**：2026-08-02（階段 1 完成）

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
- [x] 路由：`/`、`/solo`、`/create`、`/join`、`/display/:roomCode`、`/operator/:roomCode`、`/judge/:roomCode/:seat`
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

**尚未完成（依驗算刪減，屬後續階段）**

- [ ] 建立比賽表單、六碼房間、QR Code（階段 2）
- [ ] Supabase migration / RLS / RPC（階段 3）
- [ ] 雙裁判配對與 Realtime（階段 3–4）
- [ ] PWA service worker、Playwright E2E（階段 5）

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

---

### ⬜ 階段 2：房間與電視端（mock adapter，尚未連 Supabase）

- [ ] `/create`：**只露出 3 個欄位**（藍方姓名、紅方姓名、裁判人數），其餘進階設定摺疊
- [ ] 六碼房間代碼產生 + QR Code（電視／主控／裁判 A／裁判 B 四組）
- [ ] `/display/:roomCode` 電視端（沿用 `Scoreboard`），含連線狀態列
- [ ] `ScoreStore` 介面 + `LocalStore` / `MockRoomStore` 實作（無 Supabase 也能完整操作）
- [ ] 配對狀態機純函式 `src/pairing/pairingEngine.ts` + **13 條測試**
      （A 單獨／B 單獨／成立／不同選手／不同技術／逾時／同裁判連按／重送冪等／同時送出／已配對不可再配／舊事件不配新事件／結束後拒絕／暫停依設定）

### ⬜ 階段 3：Supabase

- [ ] migration：`rooms` / `matches` / `devices` / `judge_presses` / `score_events` / `rule_sets`
- [ ] RLS policy（anon 一律不可 UPDATE `matches`；讀取走 security definer RPC）
- [ ] RPC：`create_room`、`join_room`、`verify_host_pin`（pgcrypto，PIN 不存明碼、不在前端比對）
- [ ] RPC：`submit_judge_press`
      — 第一行 `pg_advisory_xact_lock(hashtext(match_id::text))`，全程單一交易
      — `client_event_id` UNIQUE，重送回傳第一次結果
      — 配對條件：不同 seat、相同 side、相同 action、`now() - server_created_at <= window`
      — 多筆候選取**最早一筆**；成立時寫唯一 `matched_group_id`，只加分一次
- [ ] RPC：`apply_gamjeom`（後端再次驗證剩餘時間 ≤ 10s）、`reverse_event`（`reversed_event_id` UNIQUE）、`advance_round(expected_round)`
- [ ] DB 併發測試 3 條（同時送出、重送、同 seat 連按）

### ⬜ 階段 4：三端接線

- [ ] `/operator/:roomCode`（PIN → 短期 token，存 sessionStorage）
- [ ] `/judge/:roomCode/:seat`（橫向、等待確認狀態、不顯示另一位裁判按了什麼）
- [ ] Realtime：DB Change（正式）＋ Presence（在線）＋ Broadcast（僅動畫）
- [ ] 重連流程：refetch `matches` → 覆蓋本機 → 顯示「已重新同步」
- [ ] 離線／逾時三態：送出中 / 已成立 / 未知（可用同 id 重送），**禁止樂觀顯示成立**

### ⬜ 階段 5：PWA 與品質

- [ ] `vite-plugin-pwa`：離線可開、`/solo` 完全離線可用
- [ ] Playwright E2E 4 條
- [ ] README 完整化（Supabase 設定、部署、手機加入主畫面、雙裁判測試方式）
- [ ] 部署（Cloudflare Pages 或 GitHub Pages + hash router 評估）

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
