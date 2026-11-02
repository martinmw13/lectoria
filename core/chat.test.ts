import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_ANSWER_CHARS,
  CHAT_MAX_MESSAGES,
  CHAT_MAX_QUESTION_CHARS,
  CHAT_MAX_TOKENS,
  bookTextUpTo,
  buildChatSystemPrompt,
  chatQuotaKeys,
  encodeSse,
  estimateCostMicro,
  parseChatRequest,
  usageCostMicro,
} from "./chat";

function validBody(over: Record<string, unknown> = {}) {
  return {
    bookId: "oz",
    upToN: 40,
    spoilers: false,
    messages: [{ role: "user", content: "Who has Dorothy met?" }],
    ...over,
  };
}

describe("parseChatRequest", () => {
  it("accepts a minimal valid request", () => {
    expect(parseChatRequest(validBody())).toEqual(validBody());
  });

  it("accepts any book id shape; the handler checks the registry", () => {
    expect(parseChatRequest(validBody({ bookId: "alice" })).bookId).toBe("alice");
  });

  it("rejects anything invalid", () => {
    const bad = [
      null,
      [],
      "x",
      validBody({ bookId: "" }),
      validBody({ bookId: 1 }),
      validBody({ bookId: "x".repeat(65) }),
      validBody({ upToN: 0 }),
      validBody({ upToN: -3 }),
      validBody({ upToN: 1.5 }),
      validBody({ upToN: "40" }),
      validBody({ spoilers: "yes" }),
      validBody({ messages: [] }),
      validBody({ messages: [{ role: "assistant", content: "hi" }] }),
      validBody({ messages: [{ role: "user", content: "" }] }),
      validBody({ messages: [{ role: "user", content: "   " }] }),
      validBody({ messages: [{ role: "user", content: "x".repeat(CHAT_MAX_QUESTION_CHARS + 1) }] }),
      validBody({
        messages: [
          { role: "user", content: "x".repeat(CHAT_MAX_QUESTION_CHARS + 1) },
          { role: "user", content: "ok" },
        ],
      }),
      validBody({
        messages: [
          { role: "assistant", content: "x".repeat(CHAT_MAX_ANSWER_CHARS + 1) },
          { role: "user", content: "ok" },
        ],
      }),
      validBody({ messages: [{ role: "system", content: "ok" }] }),
      validBody({ turnstileToken: 42 }),
      validBody({ turnstileToken: "x".repeat(2049) }),
    ];
    for (const json of bad) expect(() => parseChatRequest(json)).toThrow();
  });

  it("allows the full window of turns and alternation is not required", () => {
    const messages = Array.from({ length: CHAT_MAX_MESSAGES + 1 }, (_, i) => ({
      role: i % 2 === 0 ? "assistant" : "user",
      content: "fine",
    }));
    messages[messages.length - 1] = { role: "user", content: "last question" };
    expect(parseChatRequest(validBody({ messages })).messages).toHaveLength(CHAT_MAX_MESSAGES + 1);
  });

  it("rejects one turn past the window", () => {
    const messages = Array.from({ length: CHAT_MAX_MESSAGES + 2 }, () => ({
      role: "user",
      content: "fine",
    }));
    expect(() => parseChatRequest(validBody({ messages }))).toThrow();
  });

  it("ignores unknown keys and returns a fresh object", () => {
    const json = JSON.parse('{"bookId":"oz","upToN":3,"spoilers":true,"x":1,"messages":[{"role":"user","content":"hi","y":2}],"__proto__":{"polluted":true}}');
    const out = parseChatRequest(json);
    expect(out).toEqual({
      bookId: "oz",
      upToN: 3,
      spoilers: true,
      messages: [{ role: "user", content: "hi" }],
    });
    expect((out as unknown as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("chatQuotaKeys", () => {
  it("uses the quota prefix without BYOK and the byok prefix with it", () => {
    const base = { day: "2026-10-28", ipHash: "h", anonId: "a" };
    expect(chatQuotaKeys({ ...base, byok: false })).toEqual({
      ip: "chat:quota:2026-10-28:ip:h",
      anon: "chat:quota:2026-10-28:anon:a",
    });
    expect(chatQuotaKeys({ ...base, byok: true })).toEqual({
      ip: "chat:byok:2026-10-28:ip:h",
      anon: "chat:byok:2026-10-28:anon:a",
    });
  });
});

const paras = [
  { n: 1, ch: 1, text: "first" },
  { n: 2, ch: 1, text: "second" },
  { n: 3, ch: 2, text: "third" },
];
const chaps = [
  { ch: 1, title: "One", start_n: 1, end_n: 2 },
  { ch: 2, title: "Two", start_n: 3, end_n: 3 },
];

describe("bookTextUpTo", () => {
  it("groups by chapter and stops at upToN in order", () => {
    expect(bookTextUpTo(paras, chaps, 2, false)).toBe("Chapter 1: One\n\nfirst\n\nsecond");
  });

  it("includes everything with spoilers and clamps upToN to the max", () => {
    expect(bookTextUpTo(paras, chaps, 999, false)).toBe(
      "Chapter 1: One\n\nfirst\n\nsecond\n\nChapter 2: Two\n\nthird",
    );
    expect(bookTextUpTo(paras, chaps, 1, true)).toContain("third");
  });
});

describe("buildChatSystemPrompt", () => {
  const base = {
    title: "The Wonderful Wizard of Oz",
    author: "L. Frank Baum",
    chapterNumber: 3,
    chapterTitle: "How Dorothy Saved the Scarecrow",
    bookText: "BOOK",
  };

  it("puts the book text first, then the rules", () => {
    const prompt = buildChatSystemPrompt({ ...base, spoilers: false, bookText: "BOOK" });
    expect(prompt.startsWith('Book text of "The Wonderful Wizard of Oz" by L. Frank Baum:\nBOOK')).toBe(true);
    const bookAt = prompt.indexOf("BOOK");
    expect(prompt.indexOf("Chapter 3")).toBeGreaterThan(bookAt);
    expect(prompt).toContain("under 150 words");
    expect(prompt).not.toContain("c3p40");
  });

  it("names the scope for spoilers off and on", () => {
    expect(buildChatSystemPrompt({ ...base, spoilers: false, bookText: "x" })).toContain(
      'up to Chapter 3, "How Dorothy Saved the Scarecrow"',
    );
    expect(buildChatSystemPrompt({ ...base, spoilers: true, bookText: "x" })).toContain("whole book");
  });
});

describe("token budget", () => {
  it("leaves room for reasoning plus a full answer", () => {
    // Meta counts reasoning inside max_tokens; 400 starved follow-ups.
    expect(CHAT_MAX_TOKENS).toBeGreaterThanOrEqual(1500);
  });
});

describe("cost math", () => {
  it("estimates the reserve from chars plus a full output budget", () => {
    expect(estimateCostMicro(400)).toBe(10 + 400);
  });

  it("prices cached input below fresh input", () => {
    expect(usageCostMicro({ promptTokens: 1000, cachedTokens: 800, completionTokens: 50 })).toBe(32);
    expect(usageCostMicro({ promptTokens: 1000, cachedTokens: 0, completionTokens: 0 })).toBeGreaterThan(
      usageCostMicro({ promptTokens: 1000, cachedTokens: 1000, completionTokens: 0 }),
    );
  });
});

describe("encodeSse", () => {
  it("frames one event", () => {
    expect(encodeSse("delta", { text: "hi" })).toBe('event: delta\ndata: {"text":"hi"}\n\n');
  });
});
