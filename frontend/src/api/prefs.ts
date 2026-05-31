// Non-credential user preferences persisted in localStorage. Kept separate from
// byok (which owns "bring your own *key*"): the music style is a UI preference, not
// a secret, and must never be conflated with credentials.

const MUSIC_STYLE_KEY = 'lectoria_music_style';

export function getMusicStyle(): string {
  return localStorage.getItem(MUSIC_STYLE_KEY) || 'auto';
}

export function setMusicStyle(style: string): void {
  localStorage.setItem(MUSIC_STYLE_KEY, style);
}
