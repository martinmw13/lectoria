// @vitest-environment jsdom
// The text view mounts late on a chapter's first scene (cover first),
// so the mouseup listener must attach when the view appears, not on
// first render.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { SelectionPopover } from "./inline-figures";
import { popoverPos, usePictures } from "./use-pictures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let lastPopover: unknown = "unset";

function Harness({ showText }: { showText: boolean }) {
  const pic = usePictures({ bookId: "oz", textVersion: "v", sceneId: "c1s1", pref: { kind: "preset", id: "denslow" } });
  /* eslint-disable-next-line react-hooks/globals, react-hooks/refs -- test probe captures hook output for assertions */
  lastPopover = pic.popover;
  if (!showText) return <div data-testid="cover">cover</div>;
  return (
    /* eslint-disable-next-line react-hooks/refs -- test probe attaches the hook view ref */
    <div ref={pic.viewRef}>
      <p id="c1p1" data-n="1">
        Dorothy lived in Kansas.
      </p>
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

test("selection popover attaches when the text view mounts late", () => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  // jsdom ranges have no layout; the hook only reads the rect numbers.
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(10, 20, 100, 16);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Harness showText={false} />);
  });
  act(() => {
    root.render(<Harness showText={true} />);
  });
  const p = host.querySelector("p");
  expect(p?.firstChild).not.toBeNull();
  const range = document.createRange();
  range.selectNodeContents(p!.firstChild!);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  act(() => {
    host.querySelector("div")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  expect(lastPopover).not.toBeNull();
  act(() => {
    root.unmount();
  });
});

test("popover position is document-based, not view-relative", () => {
  expect(popoverPos({ top: 20, left: 10, width: 100 }, { x: 0, y: 0 })).toEqual({ top: 12, left: 60 });
  expect(popoverPos({ top: 20, left: 10, width: 100 }, { x: 30, y: 400 })).toEqual({
    top: 412,
    left: 90,
  });
});

function PortalHarness() {
  const pic = usePictures({ bookId: "oz", textVersion: "v", sceneId: "c9s9", pref: { kind: "preset", id: "denslow" } });
  /* eslint-disable-next-line react-hooks/globals -- test probe captures hook output for assertions */
  lastPopover = pic.popover;
  return (
    /* eslint-disable-next-line react-hooks/refs -- test probe attaches the hook view ref */
    <div ref={pic.viewRef}>
      <p id="c9p1" data-n="1">
        The cyclone spun over the gray prairie.
      </p>
      {/* eslint-disable-next-line react-hooks/refs -- test probe reads the popover for assertions */}
      {pic.popover !== null ? (
        /* eslint-disable-next-line react-hooks/refs -- test probe reads the popover for assertions */
        <SelectionPopover pos={pic.popover} popRef={pic.popRef} onPick={() => {}} />
      ) : null}
    </div>
  );
}

// The popover portals into document.body at document coordinates, so it
// stays on the selection however the reader lays scenes out.
test("selection popover portals to the body and hides on resize", () => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 100, 16);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<PortalHarness />);
  });
  const p = host.querySelector("p");
  const range = document.createRange();
  range.selectNodeContents(p!.firstChild!);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  act(() => {
    host.querySelector("div")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  expect(lastPopover).toEqual({ top: 12, left: 60 });
  const pill = document.body.querySelector(".picture-float") as HTMLElement | null;
  expect(pill).not.toBeNull();
  expect(host.querySelector(".picture-float")).toBeNull();
  expect(pill?.style.top).toBe("12px");
  expect(pill?.style.left).toBe("60px");
  // An inner scroll container moving the text moves the pill with it.
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, -80, 100, 16);
  act(() => {
    host.querySelector("div")!.dispatchEvent(new Event("scroll"));
  });
  expect(lastPopover).toEqual({ top: -88, left: 60 });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
  expect(lastPopover).toBeNull();
  expect(document.body.querySelector(".picture-float")).toBeNull();
  act(() => {
    root.unmount();
  });
});

let lastRescan: (() => void) | null = null;

function SceneHarness({ sceneId }: { sceneId: string }) {
  const pic = usePictures({ bookId: "oz", textVersion: "v", sceneId, pref: { kind: "preset", id: "denslow" } });
  /* eslint-disable-next-line react-hooks/globals, react-hooks/refs -- test probe captures hook output for assertions */
  lastPopover = pic.popover;
  /* eslint-disable-next-line react-hooks/globals, react-hooks/refs -- test probe captures hook output for assertions */
  lastRescan = pic.rescan;
  return (
    /* eslint-disable-next-line react-hooks/refs -- test probe attaches the hook view ref */
    <div ref={pic.viewRef}>
      <p id="c2p1" data-n="1">
        The house whirled around two or three times.
      </p>
    </div>
  );
}

// Continuous scroll: a selection that starts in another scene switches the
// current scene, then rescans. The switch must not drop the popover.
test("rescan after a scene switch shows the popover at document coordinates", () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 100, 16);
  vi.stubGlobal("scrollY", 300);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<SceneHarness sceneId="c2s1" />);
  });
  const range = document.createRange();
  range.selectNodeContents(host.querySelector("p")!.firstChild!);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  act(() => {
    root.render(<SceneHarness sceneId="c2s2" />);
  });
  act(() => {
    lastRescan?.();
  });
  expect(lastPopover).toEqual({ top: 312, left: 60 });
  act(() => {
    root.unmount();
  });
});

// Continuous scroll keeps one hook call while the scene in view changes,
// and a picture takes ~20 s. These pin what a scene switch mid-request does.
type Pic = ReturnType<typeof usePictures>;
let live: Pic | null = null;

function LiveHarness({ sceneId }: { sceneId: string }) {
  const pic = usePictures({ bookId: "oz", textVersion: "v", sceneId, pref: { kind: "preset", id: "denslow" } });
  /* eslint-disable-next-line react-hooks/globals -- test probe captures the live hook for request control */
  live = pic;
  return (
    /* eslint-disable-next-line react-hooks/refs -- test probe attaches the hook view ref */
    <div ref={pic.viewRef}>
      <p id="c3p1" data-n="1">
        The Scarecrow bowed politely.
      </p>
    </div>
  );
}

// fetch that answers only when the test says so.
function pendingFetch() {
  const waiting: ((body: unknown) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise((done) => waiting.push((body) => done({ json: async () => body })))),
  );
  return async (body: unknown) => {
    await act(async () => {
      waiting.shift()?.(body);
      await new Promise((r) => setTimeout(r, 0));
    });
  };
}

function mountLive(sceneId: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const show = (id: string) =>
    act(() => {
      root.render(<LiveHarness sceneId={id} />);
    });
  show(sceneId);
  const pictureSelection = () => {
    const range = document.createRange();
    range.selectNodeContents(host.querySelector("p")!.firstChild!);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    act(() => live!.illustratePassage());
  };
  return { root, show, pictureSelection };
}

const ready = (url: string) => ({ status: "ready", url, caption: "c" });

test("a figure finishing after a scene switch stays with its own scene", async () => {
  const answer = pendingFetch();
  const { root, show, pictureSelection } = mountLive("c3sB");
  pictureSelection();
  await answer(ready("/b.png"));
  const figB = live!.figures.map((f) => ({ id: f.id, url: f.url }));
  expect(figB).toHaveLength(1);

  show("c3sA");
  pictureSelection();
  expect(live!.figures.map((f) => f.phase)).toEqual(["loading"]);
  show("c3sB");
  await answer(ready("/a.png"));
  // B is untouched by A's late result.
  expect(live!.figures.map((f) => ({ id: f.id, url: f.url }))).toEqual(figB);
  show("c3sA");
  expect(live!.figures.map((f) => ({ phase: f.phase, url: f.url }))).toEqual([{ phase: "ready", url: "/a.png" }]);
  act(() => root.unmount());
});

test("a figure still generating shows loading when its scene comes back", async () => {
  const answer = pendingFetch();
  const { root, show, pictureSelection } = mountLive("c4sA");
  pictureSelection();
  show("c4sB");
  expect(live!.figures).toEqual([]);
  show("c4sA");
  expect(live!.figures.map((f) => f.phase)).toEqual(["loading"]);
  await answer(ready("/a4.png"));
  expect(live!.figures.map((f) => f.phase)).toEqual(["ready"]);
  act(() => root.unmount());
});

test("returning to a scene whose picture is generating shows the drawing", async () => {
  const answer = pendingFetch();
  const { root, show } = mountLive("c5sA");
  act(() => live!.illustrateScene());
  expect(live!.card.phase).toBe("loading");
  show("c5sB");
  expect(live!.card.phase).toBe("idle");
  show("c5sA");
  expect(live!.card.phase).toBe("loading");
  await answer(ready("/s5.png"));
  expect(live!.card).toEqual({ phase: "ready", url: "/s5.png", caption: "c" });
  act(() => root.unmount());
});

test("asking for a second picture while one is on its way says so", async () => {
  const answer = pendingFetch();
  const { root, show } = mountLive("c6sA");
  act(() => live!.illustrateScene());
  show("c6sB");
  act(() => live!.illustrateScene());
  expect(live!.card).toEqual({ phase: "idle", hint: "One picture at a time" });
  expect(fetch).toHaveBeenCalledTimes(1);
  await answer(ready("/s6.png"));
  act(() => live!.illustrateScene());
  expect(live!.card.phase).toBe("loading");
  await answer(ready("/s6b.png"));
  act(() => root.unmount());
});

test("dismissing the scene picture keeps it in the Picture Vault", async () => {
  const answer = pendingFetch();
  const { root } = mountLive("c7sA");
  act(() => live!.illustrateScene());
  await answer(ready("/s7.png"));
  expect(live!.vaultScenes.map((v) => v.url)).toEqual(["/s7.png"]);
  act(() => live!.clearScene());
  expect(live!.card.phase).toBe("idle");
  expect(live!.vaultScenes.map((v) => v.url)).toEqual(["/s7.png"]);
  act(() => root.unmount());
});

test("redrawing after a dismiss adds the new picture beside the old one", async () => {
  const answer = pendingFetch();
  const { root, show } = mountLive("c8sA");
  act(() => live!.illustrateScene());
  await answer(ready("/s8.png"));
  const first = live!.vaultScenes[0];
  act(() => live!.clearScene());
  act(() => live!.illustrateScene());
  await answer(ready("/s8b.png"));
  expect(live!.card).toEqual({ phase: "ready", url: "/s8b.png", caption: "c" });
  const kept = live!.vaultScenes;
  expect(kept.map((v) => v.url)).toEqual(["/s8.png", "/s8b.png"]);
  expect(kept[0]).toEqual(first);
  expect(new Set(kept.map((v) => v.id)).size).toBe(2);
  // A repeat answer with the same url is not kept twice.
  act(() => live!.clearScene());
  act(() => live!.illustrateScene());
  await answer(ready("/s8b.png"));
  expect(live!.vaultScenes.map((v) => v.url)).toEqual(["/s8.png", "/s8b.png"]);
  // The vault survives a scene round trip.
  show("c8sB");
  expect(live!.vaultScenes).toEqual([]);
  show("c8sA");
  expect(live!.vaultScenes.map((v) => v.url)).toEqual(["/s8.png", "/s8b.png"]);
  act(() => root.unmount());
});
