#!/usr/bin/env node
/**
 * 鎖定檔案驗證。⚠️ 本檔本身也在鎖定清單內。
 *
 * AutoResearch 迴圈的防作弊核心。AutoResearch 原版只用文字寫「不要改 prepare.py」，
 * 沒有任何技術強制；在那個情境下風險較低，因為 metric 建立在 agent 碰不到的驗證資料上。
 * 本專案不同：metric 與測試都在同一個 repo 裡，若不驗證雜湊，
 * 「把規則改成符合測試」與「把測試改成符合規則」都能讓數字變好看。
 *
 * ⚠️ 誠實說明限制：這個檢查是在本機由 agent 自己執行的，理論上可被繞過。
 *    真正的強制點是 GitHub Actions —— workflow 檔也在鎖定清單內，
 *    且 autoresearch/* 分支必須經由 PR 才能併入 main，由人類看 diff。
 *
 * 用法：
 *   node scripts/verify-locked.mjs           驗證（不符即 exit 1）
 *   node scripts/verify-locked.mjs --write   重新產生清單（只有人類該執行）
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const MANIFEST = '.autoresearch/locked.sha256'

/**
 * 鎖定清單。
 * 規則層＝算錯就是比賽算錯的程式碼；黃金測試＝規則的行為契約；
 * scripts / 設定檔＝metric 本身。這三類都不可由實驗迴圈更動。
 */
const LOCKED_GLOBS = [
  'src/rules',
  'src/match',
  'src/timer',
  'src/pairing',
  'src/types',
  'tests/golden',
  'scripts',
  '.github/workflows',
  'stryker.config.json',
  'vitest.mutation.config.ts',
  'vite.config.ts',
  'package.json',
  '.autoresearch/program.md',
]

function walk(target) {
  const abs = join(ROOT, target)
  if (!existsSync(abs)) return []
  if (statSync(abs).isFile()) return [target]
  return readdirSync(abs).flatMap((entry) => walk(join(target, entry)))
}

function collect() {
  const files = LOCKED_GLOBS.flatMap(walk)
    .map((f) => relative(ROOT, join(ROOT, f)).split(sep).join('/'))
    .filter((f, i, arr) => arr.indexOf(f) === i)
  files.sort()
  return files
}

function hashOf(file) {
  // 以正規化換行計算，避免 Windows 的 CRLF 轉換造成假警報
  const raw = readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(raw).digest('hex')
}

const files = collect()

if (process.argv.includes('--write')) {
  const lines = files.map((f) => `${hashOf(f)}  ${f}`)
  writeFileSync(join(ROOT, MANIFEST), `${lines.join('\n')}\n`, 'utf8')
  console.log(`已寫入 ${MANIFEST}（${files.length} 個鎖定檔案）`)
  process.exit(0)
}

if (!existsSync(join(ROOT, MANIFEST))) {
  console.error(`找不到 ${MANIFEST}。請先由人類執行：node scripts/verify-locked.mjs --write`)
  process.exit(1)
}

const expected = new Map(
  readFileSync(join(ROOT, MANIFEST), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [hash, ...rest] = line.split('  ')
      return [rest.join('  '), hash]
    }),
)

const problems = []
for (const file of files) {
  const want = expected.get(file)
  if (want === undefined) {
    problems.push(`新增了鎖定範圍內的檔案：${file}`)
    continue
  }
  if (hashOf(file) !== want) problems.push(`鎖定檔案被修改：${file}`)
}
for (const file of expected.keys()) {
  if (!files.includes(file)) problems.push(`鎖定檔案被刪除：${file}`)
}

if (problems.length > 0) {
  console.error('LOCKED_FILES_TAMPERED')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\n這是硬性回滾條件：git reset --hard 並在 results.tsv 記 TAMPER，然後停止迴圈。')
  process.exit(1)
}

console.log(`locked_ok: ${files.length} files verified`)
