import "server-only";
import { castUpTo, type CastSceneInput } from "@/core/cast";
import { classifyInputOf } from "@/core/fingerprint";
import { loadBookmap } from "@/server/bookmap";
import { isReadyBookId, loadBookData } from "@/server/books";

const SCENE_ID_RE = /^c\d+s\d+[a-z]?$/;

function notFound(): Response {
  return Response.json({ error: "not found" }, { status: 404 });
}

// The cast so far for one scene. Filtering runs here, so the page never
// holds a later scene's names or summaries; the panel fetches only
// while open. Shelf books with a valid bookmap only.
export async function handleCastGet(req: Request): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const bookId = params.get("bookId") ?? "";
    const sceneId = params.get("sceneId") ?? "";
    if (!isReadyBookId(bookId) || !SCENE_ID_RE.test(sceneId)) return notFound();
    const { book, scenes } = await loadBookData(bookId);
    if (!scenes.some((s) => s.id === sceneId)) return notFound();
    const map = loadBookmap(book.id, book.textVersion, classifyInputOf(scenes, book.textVersion));
    if (!map) return notFound();
    const input: CastSceneInput[] = scenes.map((s) => ({
      id: s.id,
      ch: s.ch,
      title: s.title,
      summary: s.summary,
      present: map.scenes[s.id]?.characters_present ?? [],
    }));
    const cast = castUpTo(input, map.characters, sceneId);
    return Response.json({ cast }, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch {
    console.error("cast failed");
    return Response.json({ error: "unavailable" }, { status: 500 });
  }
}

// Whether the reader shows the cast button: a shelf book whose bookmap
// loads and matches. Uploads and stale maps get no button.
export function hasCast(bookId: string, payload: { book: { id: string; textVersion: string }; scenes: Parameters<typeof classifyInputOf>[0] }): boolean {
  if (!isReadyBookId(bookId)) return false;
  return loadBookmap(payload.book.id, payload.book.textVersion, classifyInputOf(payload.scenes, payload.book.textVersion)) !== null;
}
