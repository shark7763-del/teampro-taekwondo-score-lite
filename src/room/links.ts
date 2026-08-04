/**
 * 產生給其他裝置掃描或輸入的完整網址。
 *
 * 路由使用 HashRouter，因此連結一律是 `<origin><pathname>#/display/ABC123`。
 * 部署在 GitHub Pages 的子路徑時 pathname 不是 `/`，所以不能寫死。
 */
export function appBaseUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}

export function roomLink(path: string): string {
  return `${appBaseUrl()}#${path}`
}

export function displayLink(roomCode: string): string {
  return roomLink(`/display/${roomCode}`)
}

export function operatorLink(roomCode: string): string {
  return roomLink(`/operator/${roomCode}`)
}

export function judgeLink(roomCode: string, seat: string): string {
  return roomLink(`/judge/${roomCode}/${seat}`)
}

/** 給電視畫面顯示的簡短網址（去掉 protocol），方便用手機手動輸入 */
export function shortHostUrl(): string {
  return appBaseUrl()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
}
