// The one file that owns shelf cover paths. Covers are committed
// statics under public/covers/v1, listed in cover-manifest.ts (rewritten
// by `npm run pregen:covers`). A missing cover returns null so the home
// renders the placeholder instead of a stale panel or a broken image.
import type { SkinId } from "../skin";
import { COVER_MANIFEST } from "./cover-manifest";

type Manifest = Readonly<Record<string, Readonly<Record<string, string>> | undefined>>;

export function coverFor(
  bookId: string,
  skin: SkinId,
  manifest: Manifest = COVER_MANIFEST,
): string | null {
  return manifest[skin]?.[bookId] ?? null;
}

// The shelf grid shows covers small, so it reads the ~320 px copies
// that `npm run shrink:covers` writes beside each full-size cover
// (<skin>/sm/<file>). The plate's hero cover keeps the full-size file.
export function shelfCoverFor(
  bookId: string,
  skin: SkinId,
  manifest: Manifest = COVER_MANIFEST,
): string | null {
  const url = coverFor(bookId, skin, manifest);
  return url ? smallCoverPath(url) : null;
}

export function smallCoverPath(url: string): string {
  const cut = url.lastIndexOf("/");
  return `${url.slice(0, cut)}/sm${url.slice(cut)}`;
}
