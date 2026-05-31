import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Credentials, DEFAULTS, getCredentials, saveCredentials } from '../api/byok';
import { getPresets, type StylePreset } from '../api/client';
import { getMusicStyle, setMusicStyle } from '../api/prefs';

// Per-field fallback to DEFAULTS (NOT a spread): getCredentials() returns '' for
// unset providers, and { ...DEFAULTS, ...getCredentials() } would let that '' clobber
// the 'google' default and blank the dropdown. Reproduces the old loadSettings.
function initialCredentials(): Credentials {
  const stored = getCredentials();
  return {
    llm_provider: stored.llm_provider || DEFAULTS.llm_provider,
    llm_api_key: stored.llm_api_key || DEFAULTS.llm_api_key,
    image_provider: stored.image_provider || DEFAULTS.image_provider,
    image_api_key: stored.image_api_key || DEFAULTS.image_api_key,
  };
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [creds, setCreds] = useState<Credentials>(initialCredentials);
  const [saved, setSaved] = useState(false);
  const [musicStyle, setMusicStyleState] = useState(getMusicStyle);
  const [presets, setPresets] = useState<StylePreset[]>([]);

  useEffect(() => {
    getPresets().then(setPresets).catch(() => {
      setPresets([
        { name: 'auto', description: 'No style filter - uses the full library (default)' },
        { name: 'cinematic', description: 'Orchestral, strings, brass - film scores and epic soundtracks' },
        { name: 'piano_only', description: 'Solo piano and keyboard - intimate and minimal' },
        { name: 'ambient', description: 'Synthesizers, pads, atmospheric textures - no vocals or drums' },
        { name: 'synthwave', description: 'Electronic, retro synths, 80s vibes - sci-fi and neon' },
        { name: 'noir_jazz', description: 'Jazz, saxophone, blues - smoky and dark' },
      ]);
    });
  }, []);

  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [saved]);

  function handleSave() {
    saveCredentials(creds);
    setMusicStyle(musicStyle);
    setSaved(true);
  }

  function update(field: keyof Credentials, value: string) {
    setCreds((prev) => ({ ...prev, [field]: value }));
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
            value={creds.llm_provider}
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
            value={creds.llm_api_key}
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
            value={creds.image_provider}
            onChange={(e) => update('image_provider', e.target.value)}
          >
            <option value="google">Google (Gemini image)</option>
            <option value="openai">OpenAI (DALL-E)</option>
          </select>
        </div>
        <div className="setting-row">
          <label>API Key</label>
          <input
            type="password"
            value={creds.image_api_key}
            onChange={(e) => update('image_api_key', e.target.value)}
            placeholder="Enter your API key"
          />
        </div>
      </section>

      <section className="settings-section">
        <h2>Music Style</h2>
        <p className="setting-hint">
          Choose a musical style to shape the soundtrack while you read.
          Tracks are filtered by instrument and genre before matching to each scene's emotion.
        </p>
        <div className="style-presets">
          {presets.map((preset) => (
            <label key={preset.name} className="style-preset-option">
              <input
                type="radio"
                name="music_style"
                value={preset.name}
                checked={musicStyle === preset.name}
                onChange={() => {
                  setMusicStyleState(preset.name);
                  setSaved(false);
                }}
              />
              <div>
                <span className="preset-name">{preset.name.replace(/_/g, ' ')}</span>
                <span className="preset-desc">{preset.description}</span>
              </div>
            </label>
          ))}
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
