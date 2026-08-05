# AutoResearch — TeamPro 跆拳道簡易計分系統

改編自 [karpathy/autoresearch](https://github.com/karpathy/autoresearch)。
⚠️ 本檔為鎖定檔案：由**人類**維護，agent 不得修改。

## 這裡與原版最重要的差異

原版優化 `val_bpb`，那是一個連續、單調、且建立在 agent 碰不到的驗證資料上的純量。
計分系統沒有這種東西——**規則正確性是二元的，而且沒有自動 oracle**。
若把 metric 設成「測試通過數」或「覆蓋率」，agent 寫弱測試就能讓數字上升，
完全不違反任何一條文字規則。那不是 agent 壞，是 metric 設計有洞。

所以本專案**不讓 agent 優化功能，而是優化「對既有功能的驗證強度」**：

- 主 metric = **mutation score**（Stryker），突變體從**鎖定的原始碼**產生。
- 要提高分數，測試就必須真的偵測得到「`>=` 改成 `>`」「`2` 改成 `1`」
  「`return true` 改成 `return false`」這類行為改變。**寫恆真斷言，分數不會動。**
- 這讓防作弊從「宣告式」變成「結構式」，性質等同原版的 held-out data。

## 兩個迴圈

### Loop A：測試強化（主力）

| | |
|---|---|
| 可改 | **只有測試檔**（`src/**/*.test.ts(x)`、`tests/**`，但 `tests/golden/**` 除外） |
| 鎖死 | 全部 production code |
| Metric | `mutation_score` 越高越好 |
| 單輪預算 | 8 分鐘（baseline 實測 2 分 41 秒） |

### Loop B：前端體積與效能

| | |
|---|---|
| 可改 | `src/components/**`、`src/pages/**`、`src/hooks/**`、`src/index.css` |
| 鎖死 | `src/rules`、`src/match`、`src/timer`、`src/pairing`、`src/types`、全部測試 |
| Metric | `solo_gzip_kb` 越低越好；既有測試必須全綠 |
| 單輪預算 | 3 分鐘 |

## Setup

1. 與人類確認 run tag（例如 `aug6`）。分支 `autoresearch/<tag>` 必須不存在。
2. `git checkout -b autoresearch/<tag>`
3. 讀完：本檔、`README.md`、`IMPLEMENTATION_PLAN.md`、`stryker.config.json`
4. `npm run verify-locked` 必須通過
5. 第一輪固定是 baseline：不改任何東西，直接跑一輪並記錄

## 一輪的流程

```bash
# 1. 改一件事（Loop A 只改測試檔）
# 2. commit
git add -A && git commit -m "exp: <一句話說明>"

# 3. 門檻檢查（任一項失敗 → 直接 revert，不必跑 metric）
npm run gate > gate.log 2>&1
grep -E "locked_ok|error" gate.log

# 4. 跑 metric
npm run mutation > run.log 2>&1
npm run metrics

# 5. 記錄（results.tsv 不進 git，所以 git reset 不會洗掉）
node scripts/metrics.mjs --append keep "說明"

# 6. keep → 保留 commit；revert → git reset --hard HEAD~1
```

輸出一律導向檔案再 grep 關鍵行，**不要讓完整輸出灌爆 context**。

## KEEP 條件（全部成立才算）

1. `npm run verify-locked` 通過
2. `npm run typecheck`、`npm run lint` 0 error
3. 全部測試綠，含 `tests/golden/**`
4. 主 metric 改善
5. 沒有 `.skip` / `.only` / `.todo`
6. 測試總數沒有減少

## 硬性 REVERT 條件（無裁量空間）

- 上述任一項不成立
- 主 metric 未改善（持平也 revert）
- 逾時超過預算 2 倍
- **動到鎖定檔** → `git reset --hard`、在 tsv 記 `TAMPER`、**立刻停止整個迴圈並通知人類**

## 簡潔性判準（沿用原版，可推翻主 metric）

- +0.1% 但多了 50 行重複的測試樣板？不值得
- +0.1% 來自**刪掉**重複程式碼？一定 keep
- 分數持平但測試變得好讀很多？keep

## 必須停下來等人類的情況

- 連續 3 輪無改善
- diff 超過 200 行
- 想新增任何 npm 套件
- **任何觸及規則語意的想法 → 一律停，不得自行判斷**
- 每 10 輪強制停一次

## ⚠️ 與原版最大的不同：這裡不是「NEVER STOP」

原版明講人類在睡覺、不准問、無限跑下去。**本專案不適用。**

原版跑壞了最多浪費一晚 GPU；這裡跑壞了是**選手的比賽分數算錯**。
跆拳道規則正確性沒有自動化 oracle——沒有任何 metric 知道
「Gam-jeom 5 次是該回合判負還是整場判負」。那只有人類能回答。

以下規則問題**尚未確認**，任何實驗都不得預設答案，
也不得把它們寫進 `tests/golden/`：

1. 單回合 5 次 Gam-jeom 是該回合判負還是整場判負？（目前實作＝該回合）
2. 雙方同回合同時達 5 次 Gam-jeom 如何判定？（目前會靜默落到比分數）
3. 分差 15 分：達到即止，還是該筆得分計入後才止？（目前＝計入後止）
4. 一般 Gam-jeom 可否在「尚未開始／休息中」判？（目前＝可以）
5. 1:1 後第三回合又完全平手怎麼辦？（目前 `matchWinner: null`）
6. 手動扣分可否讓分數變負？（目前 clamp 在 0，導致復原不可逆）
7. 「最後 10 秒消極行為」的官方完整清單
8. 旋轉頭部 6 分是否適用所有量級與青少年組
9. 2026-01-01 版與 2026-06-01 版的差異是否影響本系統
