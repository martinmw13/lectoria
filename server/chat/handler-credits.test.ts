import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BYOK_HEADER, CHAT_MESSAGES } from "@/core/chat";
import type { ChatErrorBody } from "@/core/chat";
import { createMemoryKV } from "@/core/images";
import { resetTurnstileWarnForTests } from "@/server/guard/human";
import { dailySpendKey, spendKey } from "@/server/guard/spend";
import { handleChatPost } from "./handler";
import { DAY, ENV, NOW, factoryFor, post, validBody } from "./test-fixtures";

// Our Meta key out of credit reads like the spend cap (offer BYOK), not
// like a crash; a reader's own key keeps the plain unavailable copy.

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetTurnstileWarnForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chat when Meta credit runs out", () => {
  for (const status of [401, 402, 403]) {
    it(`maps upstream ${status} on our key to byok_required and refunds`, async () => {
      const kv = createMemoryKV();
      const res = await handleChatPost(post(validBody()), {
        env: ENV,
        kv,
        now: NOW,
        createStreamer: factoryFor(new Error(`chat upstream ${status}`)),
      });
      const body = (await res.json()) as ChatErrorBody;
      expect(body.code).toBe("byok_required");
      expect(body.message).toBe(CHAT_MESSAGES.byok_required);
      expect(Number(await kv.get(spendKey()))).toBe(0);
      expect(Number(await kv.get(dailySpendKey(DAY)))).toBe(0);
    });
  }

  it("keeps unavailable for passing upstream errors", async () => {
    for (const message of ["chat upstream 500", "chat upstream 429", "chat upstream timeout"]) {
      const res = await handleChatPost(post(validBody()), {
        env: ENV,
        kv: createMemoryKV(),
        now: NOW,
        createStreamer: factoryFor(new Error(message)),
      });
      expect(((await res.json()) as ChatErrorBody).code).toBe("unavailable");
    }
  });

  it("does not blame our credit when the reader's own key is refused", async () => {
    const res = await handleChatPost(post(validBody(), { [BYOK_HEADER]: "reader-key-123" }), {
      env: ENV,
      kv: createMemoryKV(),
      now: NOW,
      createStreamer: factoryFor(new Error("chat upstream 401")),
    });
    expect(((await res.json()) as ChatErrorBody).code).toBe("unavailable");
  });
});
