import { notFound } from "next/navigation";
import { chapterPanels } from "@/core/panels";
import { buildReaderModel } from "@/core/reader";
import { loadBook, readyBookIds } from "@/server/books";
import { hasCast } from "@/server/cast";
import { BookView } from "../../../leer/book-view";

// One static route per book's first scene only; the rest render on
// demand and cache. Every route ships the whole book; the client
// scrolls to its scene.
export const dynamicParams = true;

export async function generateStaticParams() {
  const out: { bookId: string; sceneId: string }[] = [];
  for (const bookId of readyBookIds()) {
    const { book, scenes } = await loadBook(bookId);
    const model = buildReaderModel(book, { scenes });
    const first = model.chapters[0]?.scenes[0];
    if (first) out.push({ bookId, sceneId: first.id });
  }
  return out;
}

export default async function SceneRoute({
  params,
}: {
  params: Promise<{ bookId: string; sceneId: string }>;
}) {
  const { bookId, sceneId } = await params;
  const { book, scenes } = await loadBook(bookId);
  if (!scenes.some((s) => s.id === sceneId)) notFound();
  const model = buildReaderModel(book, { scenes });
  const panelsByChapter = model.chapters.map((chapter) => ({
    ch: chapter.ch,
    panels: chapterPanels(scenes.filter((s) => s.ch === chapter.ch)).map((g, i) => ({
      key: g.sceneIds[0] ?? `p${i + 1}`,
      caption: g.caption,
    })),
  }));
  return <BookView model={model} initialSceneId={sceneId} panelsByChapter={panelsByChapter} castOn={hasCast(bookId, { book, scenes })} />;
}
