import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase 用戶端（僅用於 Realtime Broadcast 的跨裝置連線）。
 *
 * 本階段刻意**不建立任何資料表**：房間狀態完全由主控端裝置持有，
 * Supabase 只負責把訊息從主控端送到電視端與裁判端。
 * 好處是不需要 migration 與 RLS 就能真正跨裝置運作；
 * 代價是主控端關閉時房間即結束（電視端會保留最後正式比分）。
 *
 * ⚠️ 前端只能放 anon key。anon key 本來就會出現在打包後的 JS，
 *    這是 Supabase 的設計；真正的保護一律靠 RLS，而本階段沒有任何資料表。
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

/** .env.example 內的佔位字串，避免誤把範例值當成真的設定 */
const PLACEHOLDER = /your-project-ref|your-anon-public-key/i

export function isCloudConfigured(): boolean {
  if (!SUPABASE_URL.startsWith('https://')) return false
  if (SUPABASE_ANON_KEY.length < 20) return false
  return !PLACEHOLDER.test(`${SUPABASE_URL} ${SUPABASE_ANON_KEY}`)
}

let cached: SupabaseClient | null = null

/** 取得共用的 Supabase 用戶端；未設定環境變數時回傳 null（呼叫端需退回本機模式） */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isCloudConfigured()) return null
  if (cached === null) {
    cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      // 計分是高頻操作：放寬 Realtime 的每秒事件上限
      realtime: { params: { eventsPerSecond: 40 } },
    })
  }
  return cached
}
