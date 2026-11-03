import { beforeEach, expect, test, vi } from "vitest";
import { normalizeWord } from "@/core/dictionary";
import { clearDictionaryCache, handleDefineGet, parseEntries } from "./dictionary";

const OK = [
  {
    word: "cyclone",
    phonetic: "/ˈsaɪkləʊn/",
    meanings: [
      { partOfSpeech: "noun", definitions: [{ definition: "A rotating storm.", example: "The cyclone came." }, { definition: "b" }, { definition: "c" }] },
    ],
  },
];

function req(word: string, headers: Record<string, string> = {}) {
  return new Request(`http://x/api/define?word=${encodeURIComponent(word)}`, { headers });
}

beforeEach(() => clearDictionaryCache());

test("normalizeWord keeps single English words only", () => {
  expect(normalizeWord(" Cyclone ")).toBe("cyclone");
  expect(normalizeWord("don’t")).toBe("don't");
  expect(normalizeWord("“Oz,”")).toBe("oz");
  expect(normalizeWord("two words")).toBeNull();
  expect(normalizeWord("año")).toBeNull();
  expect(normalizeWord("café")).toBeNull();
  expect(normalizeWord("a".repeat(41))).toBeNull();
});

test("parseEntries clamps senses and definitions", () => {
  const def = parseEntries("cyclone", OK);
  expect(def?.phonetic).toBe("/ˈsaɪkləʊn/");
  expect(def?.senses[0]?.defs).toHaveLength(2);
  expect(def?.senses[0]?.defs[0]).toEqual({ text: "A rotating storm.", example: "The cyclone came." });
  expect(parseEntries("x", { title: "No Definitions Found" })).toBeNull();
});

test("a found word returns the definition and caches it", async () => {
  const fetcher = vi.fn(async () => Response.json(OK));
  const res = await handleDefineGet(req("Cyclone"), fetcher as unknown as typeof fetch);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { word: string }).word).toBe("cyclone");
  expect(res.headers.get("cache-control")).toContain("s-maxage");
  await handleDefineGet(req("cyclone"), fetcher as unknown as typeof fetch);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("unknown word, bad input, cross-site and upstream failure are coded", async () => {
  const missing = vi.fn(async () => Response.json({ title: "No Definitions Found" }, { status: 404 }));
  const nf = await handleDefineGet(req("zzzq"), missing as unknown as typeof fetch);
  expect(nf.status).toBe(404);
  expect(await nf.json()).toEqual({ code: "not_found" });

  const never = vi.fn();
  expect((await handleDefineGet(req("two words"), never as unknown as typeof fetch)).status).toBe(400);
  expect((await handleDefineGet(req("ok", { "sec-fetch-site": "cross-site" }), never as unknown as typeof fetch)).status).toBe(403);
  expect(never).not.toHaveBeenCalled();

  vi.spyOn(console, "error").mockImplementation(() => {});
  const broken = vi.fn(async () => new Response("secret upstream detail", { status: 500 }));
  const down = await handleDefineGet(req("storm"), broken as unknown as typeof fetch);
  expect(down.status).toBe(503);
  const body = await down.text();
  expect(body).toBe(JSON.stringify({ code: "unavailable" }));
  expect(down.headers.get("cache-control")).toBe("no-store");
});
