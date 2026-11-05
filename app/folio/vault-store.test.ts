// @vitest-environment jsdom
// The Picture Vault is per book and saved in localStorage, so a reload
// (a fresh module) still shows every picture drawn in the book.
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

const fresh = () => import("./vault-store");
const fig = (id: string, url: string) =>
  ({ id, phase: "ready", url, quote: "q", startN: 4, endN: 5, credit: "", message: null }) as const;

test("a reload keeps the book's pictures, urls and captions only", async () => {
  const a = await fresh();
  a.keepScenePicture("oz", "c5s1", "https://blob.example/a.png", "The Scarecrow");
  a.keepFigurePicture("oz", "c5s2", fig("f1", "https://blob.example/f.png"));
  a.keepScenePicture("alice", "c1s1", "https://blob.example/alice.png", "Rabbit");
  vi.resetModules();
  const b = await fresh();
  const oz = b.bookVault("oz");
  expect(oz.scenes).toEqual([{ id: "s:https://blob.example/a.png", sceneId: "c5s1", url: "https://blob.example/a.png", caption: "The Scarecrow" }]);
  expect(oz.figures.map((f) => [f.sceneId, f.url])).toEqual([["c5s2", "https://blob.example/f.png"]]);
  // Books never share a vault.
  expect(b.bookVault("alice").scenes.map((s) => s.url)).toEqual(["https://blob.example/alice.png"]);
  expect(b.bookVault("dracula")).toEqual({ scenes: [], figures: [] });
});

test("only the vault's delete removes a picture, and it stays deleted after a reload", async () => {
  const a = await fresh();
  a.keepScenePicture("oz", "c1s1", "/a.png", "a");
  a.keepScenePicture("oz", "c2s1", "/b.png", "b");
  a.deleteVaultPicture("oz", "/a.png");
  vi.resetModules();
  expect((await fresh()).bookVault("oz").scenes.map((s) => s.url)).toEqual(["/b.png"]);
});

test("never stores blob: or data: urls, and ignores junk in storage", async () => {
  const a = await fresh();
  a.keepScenePicture("oz", "c1s1", "blob:http://x/1", "gone on reload");
  a.keepScenePicture("oz", "c1s2", "/ok.png", "ok");
  expect(localStorage.getItem(a.vaultKey("oz"))).not.toContain("blob:");
  localStorage.setItem(a.vaultKey("pride"), '{"scenes":[{"url":5},null,{"id":"x","sceneId":"c1s1","url":"/p.png","caption":"p"}],"figures":"no"}');
  localStorage.setItem(a.vaultKey("carol"), "{not json");
  vi.resetModules();
  const b = await fresh();
  expect(b.bookVault("oz").scenes.map((s) => s.url)).toEqual(["/ok.png"]);
  expect(b.bookVault("pride").scenes.map((s) => s.url)).toEqual(["/p.png"]);
  expect(b.bookVault("carol")).toEqual({ scenes: [], figures: [] });
});
