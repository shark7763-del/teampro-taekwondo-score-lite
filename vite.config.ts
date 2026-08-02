/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages 專案頁面的路徑；本機開發維持根目錄
  base: command === 'build' ? '/teampro-taekwondo-score-lite/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // 讓同網段的電視／平板／裁判手機可以連進來
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/rules/**', 'src/timer/**', 'src/match/**', 'src/pairing/**'],
    },
  },
}))
