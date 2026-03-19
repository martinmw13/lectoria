import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Settings {
  llm_provider: string;
  llm_api_key: string;
  image_provider: string;
  image_api_key: string;
}

function loadSettings(): Settings {
  return {
    llm_provider: localStorage.getItem('llm_provider') || 'google',
    llm_api_key: localStorage.getItem('llm_api_key') || '',
    image_provider: localStorage.getItem('image_provider') || 'google',
    image_api_key: localStorage.getItem('image_api_key') || '',
  };
}

function saveSettings(s: Settings) {
  localStorage.setItem('llm_provider', s.llm_provider);
  localStorage.setItem('llm_api_key', s.llm_api_key);
  localStorage.setItem('image_provider', s.image_provider);
  localStorage.setItem('image_api_key', s.image_api_key);
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [saved]);

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
  }

  function update(field: keyof Settings, value: string) {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  return (
    <div className="page settings-page">
      <header className="settings-header">
        <button className="icon-btn" onClick={() => navigate(-1)}>
          &larr;
        </button>
        <h1>Settings</h1>
      </header>

      <section className="settings-section">
        <h2>LLM Provider (BYOK)</h2>
        <div className="setting-row">
          <label>Provider</label>
          <select
            value={settings.llm_provider}
            onChange={(e) => update('llm_provider', e.target.value)}
          >
            <option value="google">Google (Gemini)</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div className="setting-row">
          <label>API Key</label>
          <input
            type="password"
            value={settings.llm_api_key}
            onChange={(e) => update('llm_api_key', e.target.value)}
            placeholder="Enter your API key"
          />
        </div>
      </section>

      <section className="settings-section">
        <h2>Image Generation Provider (BYOK)</h2>
        <div className="setting-row">
          <label>Provider</label>
          <select
            value={settings.image_provider}
            onChange={(e) => update('image_provider', e.target.value)}
          >
            <option value="google">Google (Imagen)</option>
            <option value="openai">OpenAI (DALL-E)</option>
          </select>
        </div>
        <div className="setting-row">
          <label>API Key</label>
          <input
            type="password"
            value={settings.image_api_key}
            onChange={(e) => update('image_api_key', e.target.value)}
            placeholder="Enter your API key"
          />
        </div>
      </section>

      <div className="settings-actions">
        <button className="primary" onClick={handleSave}>
          Save Settings
        </button>
        {saved && <span className="save-feedback">Saved</span>}
      </div>
    </div>
  );
}
