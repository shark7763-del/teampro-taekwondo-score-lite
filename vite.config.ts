/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** GitHub Pages 專案頁面的路徑；本機開發維持根目錄 */
const BASE = '/teampro-taekwondo-score-lite/'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'TeamPro 跆拳道簡易計分系統',
        short_name: 'TKD 計分',
        description:
          '單手機跆拳道計分：三回合兩勝制、大型計分板、離線可用。供訓練賽及模擬賽使用，非 WT 認證競賽設備。',
        lang: 'zh-Hant-TW',
        dir: 'ltr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        background_color: '#05070c',
        theme_color: '#05070c',
        categories: ['sports', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 預先快取所有靜態資源，安裝後即可完全離線使用
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // HashRouter：所有路由都由 index.html 提供
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        // 電視相容版：獨立入口，不進 React bundle。
        // Vite 會替換裡面的 %VITE_SUPABASE_*%，所以金鑰不必寫死在原始碼裡。
        tv: 'tv.html',
      },
    },
  },
  server: {
    host: true, // 讓同網段的電視／平板／裁判手機可以連進來
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    /*
     * 測試一律走本機傳輸（BroadcastChannel）。
     * 開發機上有 .env 時 Vitest 也會載入，若不清掉，
     * 房間相關測試會真的嘗試連 Supabase，結果取決於有沒有網路——那不是測試該有的行為。
     * 真實的 Realtime 連線屬於手動測試範圍，見 IMPLEMENTATION_PLAN.md。
     */
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
    coverage: {
      provider: 'v8',
      include: ['src/rules/**', 'src/timer/**', 'src/match/**', 'src/pairing/**'],
    },
  },
}))
