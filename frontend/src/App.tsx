import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import ReaderPage from './pages/ReaderPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <nav className="app-nav">
        <Link to="/" className="nav-brand">Lectoria</Link>
        <Link to="/settings" className="nav-link">Settings</Link>
      </nav>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/reader/:bookId" element={<ReaderPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
