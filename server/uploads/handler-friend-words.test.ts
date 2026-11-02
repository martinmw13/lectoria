import { describe, expect, it } from "vitest";
import { uploadDailySpendKey } from "@/core/uploads";
import { bookQuotaKeysFor } from "@/server/guard/quota";
import { spendKey } from "@/server/guard/spend";
import { handleUploadsCreate } from "./handler";
import { loadUploadJob, settleSpendOnce } from "./state";
import {
  cookiesFrom,
  createMemoryKV,
  helpfulMeta,
  memoryStore,
  postRequest,
  section,
  testEnv,
} from "./test-support";

const DAY = "2026-10-30";
const URL = "https://lectoria.test/api/uploads";
const CODE = "maple-river";
const friendEnv = () => testEnv({ friendCodes: [CODE, "lantern-meadow"] });

// 60k words in one chapter: over the 50k free cap, under the 400k
// friend cap. One part, so the hold is 5k + 60k = 65k.
function sixtyKBook() {
  return { title: "Long Friend Book", sections: [section("s1", "One", 100, 600)] };
}

// 250k words across 20 chapters of 125 paragraphs: 20 parts, so the
// friend-sized hold is 20 x 5k + 250k = 350k.
function bigFriendBook() {
  const sections = [];
  for (let s = 0; s < 20; s++) sections.push(section(`s${s}`, `Ch ${s}`, 125, 100));
  return { title: "Big Friend Book", sections };
}

// 200k words in 200 paragraphs: 2 parts, so the hold is 210k. With
// 800k already spent that day, the hold would pass the USD 1 cap.
function midFriendBook() {
  return { title: "Mid Friend Book", sections: [section("s1", "One", 200, 1000)] };
}

function anonIdOf(cookies: string): string {
  const m = /img_anon=([^;]+)/.exec(cookies);
  return (m?.[1] ?? "").split(".")[0] ?? "";
}

describe("friend word cap", () => {
  it("creates a 60k-word free book with a valid code and holds 65k", async () => {
    const kv = createMemoryKV();
    const res = await handleUploadsCreate(
      postRequest(URL, { ...sixtyKBook(), friendCode: CODE }, { "x-real-ip": "7.7.7.1" }),
      { env: friendEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; id: string; chapters: number; parts: number; friendAccepted: boolean };
    expect(json).toEqual(expect.objectContaining({ status: "created", chapters: 1, parts: 1, friendAccepted: true }));
    expect(await kv.get(spendKey())).toBe("65000");
    expect(await kv.get(uploadDailySpendKey(DAY))).toBe("65000");
    expect((await loadUploadJob(kv, json.id))?.reservedMicro).toBe(65000);
  });

  it("answers too_long with a wrong code and takes no quota or spend", async () => {
    const kv = createMemoryKV();
    const res = await handleUploadsCreate(
      postRequest(URL, { ...sixtyKBook(), friendCode: "not-a-code" }, { "x-real-ip": "7.7.7.2" }),
      { env: friendEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) },
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "too_long" }));
    expect(await kv.get(spendKey())).toBeNull();
    expect(await kv.get(uploadDailySpendKey(DAY))).toBeNull();
    const keys = bookQuotaKeysFor({ day: DAY, ip: "7.7.7.2", salt: "ip-salt-for-tests", anonId: anonIdOf(cookiesFrom(res)) });
    expect(await kv.get(keys.ip)).toBeNull();
    expect(await kv.get(keys.anon)).toBeNull();
  });

  it("answers daily_budget_reached when the hold would pass the USD 1 cap", async () => {
    const kv = createMemoryKV();
    await kv.incrBy(uploadDailySpendKey(DAY), 800_000);
    const res = await handleUploadsCreate(
      postRequest(URL, { ...midFriendBook(), friendCode: CODE }, { "x-real-ip": "7.7.7.3" }),
      { env: friendEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "daily_budget_reached" }));
    expect(await kv.get(uploadDailySpendKey(DAY))).toBe("800000");
    expect(await kv.get(spendKey())).toBe("0");
    const keys = bookQuotaKeysFor({ day: DAY, ip: "7.7.7.3", salt: "ip-salt-for-tests", anonId: anonIdOf(cookiesFrom(res)) });
    expect(await kv.get(keys.ip)).toBe("0");
    expect(await kv.get(keys.anon)).toBe("0");
  });

  it("holds 350k on a big friend book and settles down to the actual 180k", async () => {
    const kv = createMemoryKV();
    const res = await handleUploadsCreate(
      postRequest(URL, { ...bigFriendBook(), friendCode: CODE }, { "x-real-ip": "7.7.7.4" }),
      { env: friendEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; id: string; friendAccepted: boolean };
    expect(json).toEqual(expect.objectContaining({ status: "created", friendAccepted: true }));
    expect(await kv.get(spendKey())).toBe("350000");
    expect(await kv.get(uploadDailySpendKey(DAY))).toBe("350000");
    const job = await loadUploadJob(kv, json.id);
    if (!job) throw new Error("missing job");
    expect(job.reservedMicro).toBe(350000);
    expect(await settleSpendOnce(kv, job, 180_000)).toBe(true);
    expect(await kv.get(spendKey())).toBe("180000");
    expect(await kv.get(uploadDailySpendKey(DAY))).toBe("180000");
  });
});
