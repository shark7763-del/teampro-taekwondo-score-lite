/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 專案網址；未設定時系統退回本機模擬模式 */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon public key。⚠️ 絕不可放 service role key */
  readonly VITE_SUPABASE_ANON_KEY?: string
}
