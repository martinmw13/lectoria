import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BYOK_HEADER, CHAT_MESSAGES, chatQuotaKeys } from "@/core/chat";
import { createMemoryKV } from "@/core/images";
import { issueAnonId } from "@/server/guard/anon";
import { resetTurnstileWarnForTests } from "@/server/guard/human";
import { hashIp, ipBucket } from "@/server/guard/request";
import { dailySpendKey, spendKey } from "@/server/guard/spend";
import type { BookPayload } from "@/server/books";
import { handleChatPost } from "./handler";
import {
  DAY,
  ENV,
  NOW,
  OK_CHUNKS,
  anonCookieFrom,
  factoryFor,
  post,
  validBody,
} from "./test-fixtures";
import type { Capture } from "./test-fixtures";

// Upload chat through the injected loader: same prompt, spoiler gate,
// quota, and BYOK rules as shelf books. No network.
const UPLOAD_ID = "u-AAAAAAAAAAAAAAAAAAAAAA";
const EARLY_TEXT = "The cyclone cellar waited under the floor.";
const LATER_TEXT = "There is no place like home beyond marker.";

function uploadBook(): BookPayload {
  return {
    book: {
      id: UPLOAD_ID,
      title: "Upload Book",
      author: "An Author",
      textVersion: "v1",
      chapters: [
        { ch: 1, title: "Early", start_n: 1, end_n: 1 },
        { ch: 2, title: "Later", start_n: 2, end_n: 2 },
      ],
      paragraphs: [
        { id: "c1p1", ch: 1, n: 1, text: EARLY_TEXT },
        { id: "c2p2", ch: 2, n: 2, text: LATER_TEXT },
      ],
    },
    scenes: [],
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  resetTurnstileWarnForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleChatPost for uploads", () => {
  it("streams an answer scoped to upToN without spoilers and takes quota", async () => {
    const kv = createMemoryKV();
    const issued = issueAnonId(ENV.sessionSecret);
    const capture: Capture = {};
    const res = await handleChatPost(
      post(validBody({ bookId: UPLOAD_ID, upToN: 1, spoilers: false }), {
        Cookie: `img_anon=${issued.value}`,
      }),
      {
        env: ENV,
        kv,
        now: NOW,
        loadBook: async () => uploadBook(),
        createStreamer: factoryFor(OK_CHUNKS, capture),
      },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: delta\ndata: {"text":"Hello "}');
    expect(text).toContain('event: done\ndata: {"remaining":14}');
    const system = capture.messages?.[0]?.content ?? "";
    expect(capture.messages?.[0]?.role).toBe("system");
    expect(system).toContain(EARLY_TEXT);
    expect(system).not.toContain(LATER_TEXT);
    const keys = chatQuotaKeys({
      day: DAY,
      ipHash: hashIp(ipBucket("unknown", issued.id), ENV.ipSalt),
      anonId: issued.id,
      byok: false,
    });
    expect(Number(await kv.get(keys.ip))).toBe(1);
    expect(Number(await kv.get(keys.anon))).toBe(1);
  });

  it("answers 400 with no quota taken for a missing upload", async () => {
    const kv = createMemoryKV();
    const issued = issueAnonId(ENV.sessionSecret);
    const deps = {
      env: ENV,
      kv,
      now: NOW,
      loadBook: async (): Promise<BookPayload> => {
        throw new Error("notFound");
      },
      createStreamer: factoryFor(OK_CHUNKS),
    };
    const res = await handleChatPost(
      post(validBody({ bookId: UPLOAD_ID }), { Cookie: `img_anon=${issued.value}` }),
      deps,
    );
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({
      status: "error",
      code: "bad_request",
      message: CHAT_MESSAGES.bad_request,
    });
    expect(raw).not.toContain(EARLY_TEXT);
    expect(raw).not.toContain(LATER_TEXT);
    const keys = chatQuotaKeys({
      day: DAY,
      ipHash: hashIp(ipBucket("unknown", issued.id), ENV.ipSalt),
      anonId: issued.id,
      byok: false,
    });
    expect(Number(await kv.get(keys.ip))).toBe(0);
    expect(Number(await kv.get(keys.anon))).toBe(0);
    expect(await kv.get(spendKey())).toBeNull();
    expect(await kv.get(dailySpendKey(DAY))).toBeNull();
    // A second miss still answers 400 and still sets the anon cookie.
    const again = await handleChatPost(post(validBody({ bookId: UPLOAD_ID })), deps);
    expect(again.status).toBe(400);
    expect(anonCookieFrom(again)).toBeDefined();
    for (const call of warnSpy.mock.calls) {
      expect(String(call[0])).not.toContain(EARLY_TEXT);
      expect(String(call[0])).not.toContain(LATER_TEXT);
    }
  });

  it("uses the reader key for uploads and reserves no spend", async () => {
    const kv = createMemoryKV();
    const capture: Capture = {};
    const res = await handleChatPost(
      post(validBody({ bookId: UPLOAD_ID }), { [BYOK_HEADER]: "reader-meta-key-1" }),
      {
        env: ENV,
        kv,
        now: NOW,
        loadBook: async () => uploadBook(),
        createStreamer: factoryFor(OK_CHUNKS, capture),
      },
    );
    expect(res.status).toBe(200);
    expect(capture.apiKey).toBe("reader-meta-key-1");
    const text = await res.text();
    expect(text).toContain("event: done\ndata: {}");
    expect(await kv.get(spendKey())).toBeNull();
    expect(await kv.get(dailySpendKey(DAY))).toBeNull();
  });
});
