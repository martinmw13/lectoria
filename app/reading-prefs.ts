// Reading comfort: text size, line spacing and justified text. Stored in
// localStorage and set on <html> before paint (READING_SCRIPT), so the
// reading column never reflows after load. The skins keep their own base
// size and leading; these only scale them.
export const READING_KEY = "lectoria.reading.v1";
export const SIZE_STEPS = [0.9, 1, 1.12, 1.25] as const;
export const SPACING_STEPS = [0.92, 1, 1.14] as const;

export interface ReadingPrefs {
  size: number; // index into SIZE_STEPS
  spacing: number; // index into SPACING_STEPS
  justify: boolean | null; // null: the skin decides
}

export const DEFAULT_READING: ReadingPrefs = {
  size: 1,
  spacing: 1,
  justify: null,
};

function stepIn(value: unknown, count: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count ? value : fallback;
}

export function parseReading(raw: string | null): ReadingPrefs {
  try {
    const p: unknown = raw ? JSON.parse(raw) : null;
    if (typeof p !== "object" || p === null) return DEFAULT_READING;
    const r = p as Record<string, unknown>;
    return {
      size: stepIn(r.size, SIZE_STEPS.length, DEFAULT_READING.size),
      spacing: stepIn(r.spacing, SPACING_STEPS.length, DEFAULT_READING.spacing),
      justify: typeof r.justify === "boolean" ? r.justify : null,
    };
  } catch {
    return DEFAULT_READING;
  }
}

export function loadReading(): ReadingPrefs {
  try {
    return parseReading(window.localStorage.getItem(READING_KEY));
  } catch {
    return DEFAULT_READING;
  }
}

export function applyReading(prefs: ReadingPrefs, root: HTMLElement = document.documentElement): void {
  root.style.setProperty("--read-scale", String(SIZE_STEPS[prefs.size] ?? 1));
  root.style.setProperty("--read-leading", String(SPACING_STEPS[prefs.spacing] ?? 1));
  if (prefs.justify === null) root.removeAttribute("data-justify");
  else root.setAttribute("data-justify", prefs.justify ? "on" : "off");
}

export function saveReading(prefs: ReadingPrefs): void {
  try {
    window.localStorage.setItem(READING_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: the settings still apply for this visit.
  }
}

// Inline and self-contained: it runs before React and cannot import.
export const READING_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(READING_KEY)})||"null");if(!p||typeof p!=="object")return;var d=document.documentElement,s=${JSON.stringify(SIZE_STEPS)}[p.size],l=${JSON.stringify(SPACING_STEPS)}[p.spacing];if(typeof s==="number")d.style.setProperty("--read-scale",String(s));if(typeof l==="number")d.style.setProperty("--read-leading",String(l));if(p.justify===true||p.justify===false)d.setAttribute("data-justify",p.justify?"on":"off");}catch(e){}})();`;
