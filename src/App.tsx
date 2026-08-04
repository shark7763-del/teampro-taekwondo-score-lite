import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { HomePage } from './pages/HomePage'
import { SoloPage } from './pages/SoloPage'
import { MirrorDisplayPage } from './pages/MirrorDisplayPage'
import { DisplayPage, JoinPage, JudgePage, OperatorPage } from './pages/RoomPages'

/**
 * 使用 HashRouter：
 * 部署在 GitHub Pages 這類靜態主機時，`/display/ABC123` 這種深層網址
 * 直接重新整理會 404。改用 `#/display/ABC123` 可確保電視、裁判手機
 * 從 QR Code 開啟或重新整理時都不會失敗。
 */
export function App(): React.ReactElement {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/solo" element={<SoloPage />} />
        <Route path="/mirror" element={<MirrorDisplayPage />} />
        <Route path="/join" element={<JoinPage />} />
        {/* 不帶房號時由電視端自行產生一組並轉址，教練不必在電視上打字 */}
        <Route path="/display" element={<DisplayPage />} />
        <Route path="/display/:roomCode" element={<DisplayPage />} />
        <Route path="/operator/:roomCode" element={<OperatorPage />} />
        <Route path="/judge/:roomCode/:seat" element={<JudgePage />} />
        {/* 舊版「建立多人比賽」入口：現在改由電視端開房間 */}
        <Route path="/create" element={<Navigate to="/display" replace />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </HashRouter>
  )
}
