import { buildReaderModel } from "@/core/reader";
import { loadBook } from "@/server/books";
import { loadNarrationEntries } from "@/server/narration";
import { Reader } from "../../reader";
import "../../home/home-backdrop.css";
import "../../styles/reader-wide.css";

// Static shell: audio and music state persist across scene routes.
// Only slim metadata reaches the client: id, chapter, ordinal range,
// emotion. The chapter narration index (~1 MB) stays server-side; the
// client gets one small {chapter → src, manifest} map.
export default async function ReadBookLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;
  const { book, scenes } = await loadBook(bookId);
  const model = buildReaderModel(book, { scenes });
  const slim = model.chapters.flatMap((chapter) =>
    chapter.scenes.map((scene) => {
      const paras = scene.paragraphs;
      return {
        id: scene.id,
        ch: chapter.ch,
        startN: paras[0]?.n ?? 0,
        endN: paras[paras.length - 1]?.n ?? 0,
        emotion: scene.emotion,
      };
    }),
  );
  const chapters = model.chapters.map((chapter) => ({
    ch: chapter.ch,
    title: chapter.title,
    firstSceneId: chapter.scenes[0]?.id ?? "",
  }));
  const narration = loadNarrationEntries(bookId);
  return (
    <Reader
      bookId={model.bookId}
      scenes={slim}
      chapters={chapters}
      bookTitle={model.title}
      bookAuthor={model.author}
      narration={narration}
    >
      {children}
    </Reader>
  );
}
