import { defineConfig } from 'vitest/config'

/**
 * 突變測試專用的 Vitest 設定。⚠️ 鎖定檔案，實驗迴圈不得修改。
 *
 * 為什麼不共用 vite.config.ts：
 * Stryker 每產生一個突變體就要重跑一次測試，成本被乘上數百倍。
 * 主設定會載入 jsdom、React Testing Library 與頁面整合測試
 * （其中黃金測試還有真實的秒級等待），跑完一輪要好幾小時。
 *
 * 突變體只從規則層產生（見 stryker.config.json 的 mutate），
 * 所以這裡只收「純函式、不需要瀏覽器」的測試，environment 用 node。
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: [
      'src/rules/**/*.test.ts',
      'src/match/**/*.test.ts',
      'src/timer/**/*.test.ts',
      'src/pairing/**/*.test.ts',
      'src/room/clock.test.ts',
      'tests/golden/rules.golden.test.ts',
    ],
  },
})
