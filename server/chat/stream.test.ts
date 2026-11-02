import { describe, expect, it, vi } from "vitest";
import { createChatStreamer } from "./stream";
import type { ChatStreamChunk } from "./stream";

const MESSAGES = [{ role: "system" as const, content: "sys" }];

function sseResponse(frames: string[], status = 200): Response {
  return new Response(frames.map((f) => `data: ${f}\n\n`).join(""), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect(iter: AsyncIterable<ChatStreamChunk>): Promise<ChatStreamChunk[]> {
  const out: ChatStreamChunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

describe("createChatStreamer", () => {
  it("posts the pinned model and parses deltas and usage", async () => {
    const fetchFn = vi.fn(async () =>
      sseResponse([
        '{"choices":[{"delta":{"content":"Hello"}}]}',
        '{"choices":[{"delta":{"reasoning_content":"secret thought"}}]}',
        '{"choices":[{"delta":{"content":""}}]}',
        '{"choices":[{"delta":{"content":" there"}}]}',
        '{"choices":[{"delta":{}}],"usage":{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":10},"completion_tokens":5}}',
        "[DONE]",
      ]),
    );
    const chunks = await collect(
      createChatStreamer({ apiKey: "k", fetchFn }).stream({ messages: MESSAGES }),
    );
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "muse-spark-1.3-contributor",
      messages: MESSAGES,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 2000,
      reasoning_effort: "low",
    });
    expect(chunks).toEqual([
      { type: "delta", text: "Hello" },
      { type: "delta", text: " there" },
      { type: "usage", promptTokens: 100, cachedTokens: 10, completionTokens: 5 },
    ]);
  });

  it("throws only the status number on non-2xx, never key or body text", async () => {
    const fetchFn = vi.fn(async () => new Response("upstream blew up xyz", { status: 500 }));
    const streamer = createChatStreamer({ apiKey: "secret-key-1", fetchFn });
    const error = await collect(streamer.stream({ messages: MESSAGES })).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("500");
    expect(error?.message).not.toContain("secret-key-1");
    expect(error?.message).not.toContain("upstream blew up");
  });

  it("wraps network failures without their text", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("socket exploded secret");
    });
    const streamer = createChatStreamer({ apiKey: "k", fetchFn });
    const error = await collect(streamer.stream({ messages: MESSAGES })).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).not.toContain("socket exploded");
  });

  it("times out before the first token", async () => {
    const hanging = (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    const streamer = createChatStreamer({ apiKey: "k", fetchFn: hanging, firstTokenTimeoutMs: 30 });
    const error = await collect(streamer.stream({ messages: MESSAGES })).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toBe("chat upstream first-token timeout");
  });

  it("times out a stalled stream after the first token", async () => {
    const encoder = new TextEncoder();
    const fetchFn = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const streamer = createChatStreamer({ apiKey: "k", fetchFn, totalTimeoutMs: 50 });
    const gen = streamer.stream({ messages: MESSAGES })[Symbol.asyncIterator]();
    await expect(gen.next()).resolves.toEqual({ done: false, value: { type: "delta", text: "hi" } });
    await expect(gen.next()).rejects.toThrow("chat upstream total timeout");
  });

  it("aborts when the caller signal aborts", async () => {
    const ctrl = new AbortController();
    const hanging = (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("gone", "AbortError")), {
          once: true,
        });
      });
    const streamer = createChatStreamer({ apiKey: "k", fetchFn: hanging });
    const pending = streamer.stream({ messages: MESSAGES, signal: ctrl.signal })[Symbol.asyncIterator]().next();
    ctrl.abort();
    await expect(pending).rejects.toSatisfy(
      (e: unknown) => e instanceof DOMException && e.name === "AbortError",
    );
  });
});
