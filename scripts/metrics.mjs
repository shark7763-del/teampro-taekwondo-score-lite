#!/usr/bin/env node
/**
 * AutoResearch metric 計算。⚠️ 鎖定檔案，實驗迴圈不得修改。
 *
 * 只讀取既有產物並輸出摘要，本身不執行測試——
 * 這樣 metric 的定義與「怎麼跑」分開，agent 無法在計算過程動手腳。
 *
 * 用法：
 *   npm run mutation && node scripts/metrics.mjs          輸出摘要
 *   node scripts/metrics.mjs --append keep "說明文字"      同時追加一列到 results.tsv
 *
 * 主 metric：mutation_score（越高越好）
 * 次 metric：solo_gzip_kb（越低越好）
 */
import { readFileSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()
const MUTATION_JSON = 'reports/mutation/mutation.json'
const RESULTS = 'results.tsv'

/** 這些狀態代表「測試抓到了這個行為改變」 */
const KILLED = new Set(['Killed', 'Timeout'])
/** 這些代表「改了行為但沒有任何測試發現」——包含完全沒被執行到的程式碼 */
const MISSED = new Set(['Survived', 'NoCoverage'])

function mutationScore() {
  const path = join(ROOT, MUTATION_JSON)
  if (!existsSync(path)) return null

  const report = JSON.parse(readFileSync(path, 'utf8'))
  const perFile = []
  let killed = 0
  let missed = 0

  for (const [file, data] of Object.entries(report.files ?? {})) {
    let fKilled = 0
    let fMissed = 0
    for (const mutant of data.mutants ?? []) {
      if (KILLED.has(mutant.status)) fKilled += 1
      else if (MISSED.has(mutant.status)) fMissed += 1
    }
    killed += fKilled
    missed += fMissed
    const total = fKilled + fMissed
    if (total > 0) {
      perFile.push({ file: file.replace(/\\/g, '/'), score: (100 * fKilled) / total, total })
    }
  }

  const total = killed + missed
  return {
    score: total === 0 ? 0 : (100 * killed) / total,
    killed,
    missed,
    total,
    perFile: perFile.sort((a, b) => a.score - b.score),
  }
}

/** dist/ 內最大的一支 JS（即進入點）的 gzip 大小。需要先 npm run build。 */
function bundleKb() {
  const dir = join(ROOT, 'dist/assets')
  if (!existsSync(dir)) return null
  const js = readdirSync(dir).filter((f) => f.endsWith('.js'))
  if (js.length === 0) return null
  let totalRaw = 0
  let totalGz = 0
  let entryGz = 0
  for (const f of js) {
    const buf = readFileSync(join(dir, f))
    const gz = gzipSync(buf, { level: 9 }).length
    totalRaw += statSync(join(dir, f)).size
    totalGz += gz
    if (gz > entryGz) entryGz = gz
  }
  return {
    entryGzKb: entryGz / 1024,
    totalGzKb: totalGz / 1024,
    totalRawKb: totalRaw / 1024,
    chunks: js.length,
  }
}

function shortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'nogit'
  }
}

const mutation = mutationScore()
const bundle = bundleKb()

console.log('---')
console.log(`mutation_score:   ${mutation === null ? 'n/a' : mutation.score.toFixed(2)}`)
console.log(`mutants_killed:   ${mutation === null ? 'n/a' : mutation.killed}`)
console.log(`mutants_missed:   ${mutation === null ? 'n/a' : mutation.missed}`)
console.log(`mutants_total:    ${mutation === null ? 'n/a' : mutation.total}`)
console.log(`solo_gzip_kb:     ${bundle === null ? 'n/a' : bundle.entryGzKb.toFixed(1)}`)
console.log(`total_gzip_kb:    ${bundle === null ? 'n/a' : bundle.totalGzKb.toFixed(1)}`)
console.log(`chunks:           ${bundle === null ? 'n/a' : bundle.chunks}`)
console.log(`commit:           ${shortSha()}`)

if (mutation !== null) {
  console.log('---  分數最低的檔案（下一輪實驗的目標）')
  for (const f of mutation.perFile.slice(0, 5)) {
    console.log(`  ${f.score.toFixed(2).padStart(6)}%  ${f.file}  (${f.total} mutants)`)
  }
}

const appendAt = process.argv.indexOf('--append')
if (appendAt !== -1) {
  const status = process.argv[appendAt + 1] ?? 'unknown'
  const description = process.argv[appendAt + 2] ?? ''
  const path = join(ROOT, RESULTS)
  if (!existsSync(path)) {
    appendFileSync(path, 'commit\tmutation_score\tsolo_gzip_kb\tstatus\tdescription\n', 'utf8')
  }
  const row = [
    shortSha(),
    mutation === null ? '0.00' : mutation.score.toFixed(2),
    bundle === null ? '0.0' : bundle.entryGzKb.toFixed(1),
    status,
    description.replace(/\t/g, ' '),
  ].join('\t')
  appendFileSync(path, `${row}\n`, 'utf8')
  console.log(`\n已追加到 ${RESULTS}：${row}`)
}
