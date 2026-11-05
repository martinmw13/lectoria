// The whole book as one continuous scroll: every chapter with its panels
// strip inline, every scene a section. The scene most in view drives the
// picture card, the vault, the pager, and the music session. Native
// scrolling only: no wheel hijacking, no sub-pages, no page-turn keys.
"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ReaderModel } from "@/core/reader";
import { effectiveImageStylePref, loadImageStylePref, saveImageStylePref } from "../image-style";
import type { ImageStylePref } from "../image-style";
import { useSkin } from "../use-skin";
import { BandPager, Divider } from "../folio/chrome";
import { figuresAfter, groupFiguresByEndN } from "../folio/figure-placement";
import { ImagePane } from "../folio/image-pane";
import { InlineFigureView } from "../folio/inline-figures";
import { Lightbox } from "../folio/lightbox";
import { usePictures } from "../folio/use-pictures";
import { PictureVault } from "../folio/vault";
import type { VaultFigure, VaultScene } from "../folio/vault-store";
import { chapterHeading } from "./chapter-heading";
import { coverTitleLong } from "../folio/panels";
import type { ChapterPanel } from "../folio/panels";
import { PanelsModal } from "../folio/panels-modal";
import { GOTO_SCENE_EVENT, setCurrentSceneId } from "./current-scene";
import { attachFollowPause, noteUserScroll, pickCurrentScene, scrollToSceneId } from "./scroll-helpers";
import { ReadAlong } from "../narration/read-along";
import { MarksList } from "./marks-list";
import { CastList } from "./cast-list";
import type { Mark } from "./marks";
import { NoteEditor, SelectionMenu, type NoteTarget } from "./selection-menu";
import { useMarks } from "./use-marks";

function pulse(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
  window.setTimeout(() => el.classList.remove("pulse"), 650);
}

export function BookView({
  model,
  initialSceneId,
  panelsByChapter,
  visualsOn: visualsOnProp,
  castOn = false,
}: {
  model: ReaderModel;
  initialSceneId: string;
  panelsByChapter: { ch: number; panels: ChapterPanel[] }[];
  visualsOn?: boolean;
  /** Show the spoiler-free cast codex (shelf books with a bookmap). */
  castOn?: boolean;
}) {
  // Pictures serve uploads too; the vault and panels stay mounted and
  // the images API fills them from the uploaded text.
  const visualsOn = visualsOnProp ?? true;
  const [storedPref, setStoredPref] = useState<ImageStylePref | null>(null);
  // Server render uses the default so hydration matches; the live skin
  // applies on mount via useSyncExternalStore.
  const skin = useSkin();
  const pref = effectiveImageStylePref(storedPref, skin);
  const [currentId, setCurrentId] = useState(initialSceneId);
  const [panelsCh, setPanelsCh] = useState<number | null>(null);
  const readColRef = useRef<HTMLElement | null>(null);
  const figEls = useRef(new Map<string, HTMLElement>());
  const pic = usePictures({ bookId: model.bookId, textVersion: model.textVersion, sceneId: currentId, pref });
  const marks = useMarks(model.bookId, readColRef);
  const [noteFor, setNoteFor] = useState<NoteTarget | null>(null);
  const order = useMemo(() => model.chapters.flatMap((c) => c.scenes.map((s) => s.id)), [model]);
  const chapterStarts = useMemo(() => model.chapters.map((c) => order.indexOf(c.scenes[0]?.id ?? "")), [model, order]);
  const sceneOf = useMemo(() => {
    const map = new Map<string, { ch: number; k: number; n: number; chapterTitle: string }>();
    for (const chapter of model.chapters) {
      chapter.scenes.forEach((s, i) => {
        map.set(s.id, { ch: chapter.ch, k: i + 1, n: chapter.scenes.length, chapterTitle: chapter.title });
      });
    }
    return map;
  }, [model]);
  const panelsOf = useMemo(() => new Map(panelsByChapter.map((e) => [e.ch, e.panels])), [panelsByChapter]);
  const titles = useMemo(() => new Map(model.chapters.map((c) => [c.ch, c.title])), [model]);
  const info = sceneOf.get(currentId);
  // Spoiler reach: the highest chapter in view this visit. A chapter's
  // page and captions load only once the reader has reached it.
  const [maxReached, setMaxReached] = useState(() => sceneOf.get(initialSceneId)?.ch ?? 1);
  const maxReachedRef = useRef(maxReached);
  maxReachedRef.current = maxReached;
  const infoCh = info?.ch;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- spoiler reach tracks the highest chapter in view
    if (infoCh !== undefined) setMaxReached((prev) => Math.max(prev, infoCh));
  }, [infoCh]);
  const bookIndex = order.indexOf(currentId);
  const lastChapter = model.chapters[model.chapters.length - 1]?.ch ?? 0;

  // One commit path for every scene change: state, the live store the
  // music container reads, and the deep-link URL. No router pushes, so
  // scrolling never remounts.
  const commitScene = useCallback(
    (id: string) => {
      setCurrentId((prev) => (prev === id ? prev : id));
      setCurrentSceneId(id);
      window.history.replaceState(null, "", `/read/${model.bookId}/${id}`);
    },
    [model.bookId],
  );

  // Land on the deep-linked scene with no animation, focus the column so
  // native keys scroll it, and pause narration follow on user input.
  useEffect(() => {
    const col = readColRef.current;
    if (!col) return;
    col.focus({ preventScroll: true });
    setCurrentSceneId(initialSceneId);
    scrollToSceneId(col, initialSceneId, false);
    return attachFollowPause(col);
  }, [initialSceneId]);

  // The scene under the reading line (40% down the column) is current.
  // A thin rootMargin band, not ratios: a long scene filling the screen
  // must beat a short one fully in view, and the band fires exactly when
  // a section crosses the line. Ties keep document order. One observer,
  // no scroll listeners, no layout reads on scroll.
  useEffect(() => {
    const col = readColRef.current;
    if (!col) return;
    const seen = new Map<string, { id: string; ratio: number }>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.sceneId;
          if (!id) continue;
          if (entry.isIntersecting) seen.set(id, { id, ratio: entry.intersectionRatio });
          else seen.delete(id);
        }
        const next = pickCurrentScene(order, seen);
        if (!next) return;
        // Focus in a far chapter scrolls it under the reading line; that
        // scroll must not commit a later scene or push "reached" (and the
        // chat spoiler gate) forward.
        const active = document.activeElement;
        const focusCh = Number(
          active instanceof HTMLElement ? active.closest?.("[data-ch]")?.getAttribute("data-ch") : NaN,
        );
        if (
          Number.isFinite(focusCh) &&
          focusCh > maxReachedRef.current &&
          (sceneOf.get(next)?.ch ?? 0) > maxReachedRef.current
        )
          return;
        commitScene(next);
      },
      { root: col, rootMargin: "-40% 0px -59% 0px", threshold: 0 },
    );
    for (const section of col.querySelectorAll("[data-scene-id]")) io.observe(section);
    return () => io.disconnect();
  }, [order, commitScene, sceneOf]);

  // Chapter jumps from outside the column arrive here.
  useEffect(() => {
    const onGoto = (event: Event) => gotoScene((event as CustomEvent<string>).detail);
    window.addEventListener(GOTO_SCENE_EVENT, onGoto);
    return () => window.removeEventListener(GOTO_SCENE_EVENT, onGoto);
  }, [gotoScene]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only image-style pref restore from localStorage
    setStoredPref(loadImageStylePref());
  }, []);

  function changePref(next: ImageStylePref) {
    setStoredPref(next);
    saveImageStylePref(next);
  }

  const closePanels = useCallback(() => setPanelsCh(null), []);

  const figsByN = useMemo(() => groupFiguresByEndN(pic.figures), [pic.figures]);

  // The vault holds the whole book, so a picture may sit in another
  // scene: go there first, then find the figure (or its paragraph, if it
  // was taken out of the text) once that scene has painted.
  function gotoFigure(fig: VaultFigure) {
    if (fig.sceneId !== currentId) gotoScene(fig.sceneId);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el =
          figEls.current.get(fig.id) ?? readColRef.current?.querySelector<HTMLElement>(`p[data-n="${fig.endN}"]`) ?? null;
        const col = readColRef.current;
        if (col) noteUserScroll(col);
        el?.scrollIntoView({ block: "nearest" });
        pulse(el);
      }),
    );
  }

  function gotoMark(mark: Mark) {
    const col = readColRef.current;
    const p = col?.querySelector<HTMLElement>(`p[data-n="${mark.startN}"]`) ?? null;
    if (col) noteUserScroll(col);
    p?.scrollIntoView({ block: "center" });
    pulse(p);
  }

  function gotoScenePicture(scene: VaultScene) {
    if (scene.sceneId !== currentId) gotoScene(scene.sceneId);
    const img = document.querySelector(".img-pane .pane-img");
    pulse(img instanceof HTMLElement ? img : null);
  }

  function gotoScene(id: unknown) {
    if (typeof id !== "string") return;
    pic.hidePopover();
    const col = readColRef.current;
    // Commit the target itself: the reading-line observer only sees scene
    // sections, and on narrow screens a tall chapter heading can sit under
    // the line after the jump, leaving the previous scene current.
    if (col && scrollToSceneId(col, id, true)) commitScene(id);
  }

  // A selection that starts in another scene moves the current scene
  // there; the popover follows without a second tap. Chapter headings and
  // the panels strip sit outside scene sections, so they never offer it.
  function onReadMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const node = sel.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    const section = el?.closest?.("[data-scene-id]") ?? null;
    const id = section instanceof HTMLElement ? section.dataset.sceneId : null;
    if (!id || id === currentId) return;
    commitScene(id);
    requestAnimationFrame(() => pic.rescan());
  }

  return (
    <>
      {visualsOn ? (
        <>
          <ImagePane
            card={pic.card}
            needHuman={pic.needHuman}
            onHumanPass={pic.submitHumanToken}
            onPicture={() => pic.illustrateScene()}
            onRetry={() => pic.illustrateScene()}
            onClear={pic.clearScene}
            onOpen={pic.lightbox.open}
            onPictureChapter={info ? () => setPanelsCh(info.ch) : null}
          />
          <Divider />
        </>
      ) : null}
      <main id="story" className="read-col" ref={readColRef} tabIndex={-1} aria-label="Reading column" onMouseUp={onReadMouseUp}>
        <h1 className="sr-only">{model.title}</h1>
        <ReadAlong columnRef={readColRef} />
        {model.chapters.map((chapter) => {
          const heading = chapterHeading(chapter.title);
          const coverLong = coverTitleLong(heading.title);
          return (
            <div className="chapter-block" key={chapter.ch} data-ch={chapter.ch}>
              {heading.showNumber ? (
                <>
                  <div className="kicker">Chapter</div>
                  <p className="cover-num" data-long={coverLong} aria-label={`Chapter ${chapter.ch}`}>
                    {chapter.ch}
                  </p>
                </>
              ) : null}
              <h2 className="chapter-title cover-title" data-long={coverLong}>
                {heading.title}
              </h2>
              <hr className="cover-rule" />
              {chapter.scenes.map((s, si) => (
                <section
                  key={s.id}
                  className="book-section"
                  data-scene-id={s.id}
                  aria-label={s.title}
                  // Strings for the skin's `content:`; counters can't cross content-visibility.
                  style={
                    {
                      "--scene-n": `"${si + 1}"`,
                      "--scene-of": `" of ${chapter.scenes.length}"`,
                    } as CSSProperties
                  }
                >
                  <div
                    className={si === 0 ? "body-text dropcap" : "body-text"}
                    ref={s.id === currentId ? pic.viewRef : undefined}
                  >
                    {s.paragraphs.map((p, i, arr) => (
                      <Fragment key={p.id}>
                        <p id={p.id} data-n={p.n}>
                          {p.text}
                        </p>
                        {(visualsOn ? figuresAfter(arr, i, figsByN) : []).map((fig) => (
                          <InlineFigureView
                            key={fig.id}
                            figure={fig}
                            onRemove={() => pic.removeFigure(fig.id)}
                            onRetry={() => pic.retryFigure(fig.id)}
                            onOpen={pic.lightbox.open}
                            refCb={(el) => {
                              if (el) figEls.current.set(fig.id, el);
                              else figEls.current.delete(fig.id);
                            }}
                          />
                        ))}
                      </Fragment>
                    ))}
                    {s.id === currentId && pic.popover !== null ? (
                      <SelectionMenu
                        pos={pic.popover}
                        popRef={pic.popRef}
                        marks={marks}
                        showPicture={visualsOn}
                        onPicture={() => pic.illustratePassage()}
                        onNote={setNoteFor}
                        onClose={pic.hidePopover}
                      />
                    ) : null}
                  </div>
                </section>
              ))}
              {chapter.ch === lastChapter ? (
                <p className="the-end">The end.</p>
              ) : visualsOn ? (
                <div className="chapter-relive">
                  <button
                    type="button"
                    className="panels-link"
                    tabIndex={chapter.ch === infoCh ? undefined : -1}
                    onClick={() => setPanelsCh(chapter.ch)}
                  >
                    Relive this chapter in panels
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </main>
      {visualsOn ? (
        <PictureVault
          scenes={pic.vaultScenes}
          figures={pic.vaultFigures}
          onGotoScene={gotoScenePicture}
          onGotoFigure={gotoFigure}
          onOpen={pic.lightbox.open}
          onDelete={pic.deleteFromVault}
          pref={pref}
          onPrefChange={changePref}
        >
          {castOn ? <CastList bookId={model.bookId} sceneId={currentId} /> : null}
          <MarksList marks={marks.marks} onGo={gotoMark} onRemove={marks.remove} />
        </PictureVault>
      ) : null}
      <BandPager
        k={info?.k ?? 1}
        n={info?.n ?? 1}
        bookIndex={Math.max(0, bookIndex)}
        bookTotal={order.length}
        onPrev={() => gotoScene(bookIndex > 0 ? order[bookIndex - 1] : undefined)}
        onNext={() => gotoScene(bookIndex < order.length - 1 ? order[bookIndex + 1] : undefined)}
        atStart={bookIndex <= 0}
        atBookEnd={bookIndex >= order.length - 1}
        chapterStarts={chapterStarts}
      />
      {visualsOn ? null : (
        <div className="marks-dock">
          <MarksList marks={marks.marks} onGo={gotoMark} onRemove={marks.remove} />
        </div>
      )}
      {noteFor ? <NoteEditor key={noteFor.draft.quote} target={noteFor} marks={marks} onClose={() => setNoteFor(null)} /> : null}
      <Lightbox item={pic.lightbox.item} onClose={pic.lightbox.close} />
      {visualsOn && panelsCh !== null ? (
        <PanelsModal
          ch={panelsCh}
          chapterTitle={titles.get(panelsCh) ?? ""}
          panels={panelsOf.get(panelsCh) ?? []}
          bookId={model.bookId}
          textVersion={model.textVersion}
          pref={pref}
          reachedCh={maxReached}
          onClose={closePanels}
          onOpenArt={pic.lightbox.open}
        />
      ) : null}
    </>
  );
}
