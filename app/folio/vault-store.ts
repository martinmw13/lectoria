// Session Picture Vault: scene pictures and inline figures kept per scene.
// Dismissing a picture in the reader never removes an entry here; only the
// vault itself may delete entries.
import type { InlineFigure } from "./use-pictures";

// A scene picture kept in the Picture Vault. Dismissing the pane card
// (the X) only clears the pane; vault entries stay for the session.
export interface VaultScene {
  id: string;
  url: string;
  caption: string;
}

const sceneVaultCache = new Map<string, VaultScene[]>();
const figureVaultCache = new Map<string, InlineFigure[]>();
let vaultSeq = 1;

export function sceneVault(sceneId: string): VaultScene[] {
  return sceneVaultCache.get(sceneId) ?? [];
}

// Adds a finished scene picture to the vault under a fresh id. The same
// url twice (a repeat answer) is kept once; earlier entries are untouched.
export function keepScenePicture(sceneId: string, url: string, caption: string): VaultScene[] {
  const prev = sceneVault(sceneId);
  if (prev.some((v) => v.url === url)) return prev;
  const next = [...prev, { id: `s${vaultSeq++}`, url, caption }];
  sceneVaultCache.set(sceneId, next);
  return next;
}

export function figureVault(sceneId: string): InlineFigure[] {
  return figureVaultCache.get(sceneId) ?? [];
}

// Adds a finished inline figure to the vault. Removing the figure from the
// text (its X) never touches this cache.
export function keepFigurePicture(sceneId: string, fig: InlineFigure): InlineFigure[] {
  const prev = figureVault(sceneId);
  if (fig.phase !== "ready" || fig.url === null || prev.some((v) => v.id === fig.id || v.url === fig.url)) return prev;
  const next = [...prev, fig];
  figureVaultCache.set(sceneId, next);
  return next;
}
