import "server-only";
import { BYOK_HEADER } from "@/core/chat";
import type { KV } from "@/core/types";
import {
  UPLOAD_HTTP_STATUS,
  UPLOAD_JEV_MODEL,
  UPLOAD_MAX_BODY_BYTES,
  UPLOAD_MESSAGES,
  UPLOAD_MODEL,
  UPLOAD_STEP_BODY_BYTES,
  isUploadId,
  parseStepBody,
  parseUploadCreate,
  type UploadCreateBody,
  type UploadErrorCode,
} from "@/core/uploads";
import {
  issueAnonId,
  parseAnonCookie,
  serializeAnonCookie,
  verifyAnonCookie,
} from "@/server/guard/anon";
import { readBodyCapped } from "@/server/guard/body";
import { checkHuman } from "@/server/guard/human";
import { createRestKV } from "@/server/guard/kv";
import { acceptFriendCode, bookQuotaKeysFor, friendGuessKeyFor } from "@/server/guard/quota";
import { clientIp, rejectsCrossSite, utcDay } from "@/server/guard/request";
import { createJevClient, type JevClient } from "../../pipeline/jev";
import { createMetaClient, type MetaClient } from "../../pipeline/meta";
import { createUploadStore, type UploadStore } from "./blob";
import { createUpload } from "./create";
import { readUploadEnv, type UploadEnv } from "./env";
import { loadUploadJob, UploadFailure } from "./state";
import { stepUpload } from "./step";
import { fetchWithTimeout, JEV_CALL_TIMEOUT_MS, META_CALL_TIMEOUT_MS } from "./work";

export interface UploadHandlerDeps {
  env?: UploadEnv;
  kv?: KV;
  store?: UploadStore;
  fetchFn?: typeof fetch;
  // Injected model clients (tests). Undefined builds from env/keys.
  meta?: MetaClient | null;
  jev?: JevClient | null;
  now?: Date;
}

// Codes only, never internals or keys. Server failures error, the rest warn.
function fail(code: UploadErrorCode, cookies: string[], unexpected = false): Response {
  if (unexpected) console.error(`upload ${code}`);
  else console.warn(`upload ${code}`);
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(
    { status: "error", code, message: UPLOAD_MESSAGES[code] },
    { status: UPLOAD_HTTP_STATUS[code], headers },
  );
}

function withCookies(cookies: string[]): Headers {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

// Null when absent, false when malformed; the key itself is never logged.
function parseByokHeader(raw: string | null): string | null | false {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 400 || !/^[\x20-\x7E]+$/.test(trimmed)) return false;
  return trimmed;
}

function buildMeta(deps: UploadHandlerDeps, fetchFn: typeof fetch, apiKey: string): MetaClient | null {
  if (deps.meta !== undefined) return deps.meta;
  return createMetaClient({ fetchFn: fetchWithTimeout(fetchFn, META_CALL_TIMEOUT_MS), apiKey, model: UPLOAD_MODEL });
}

function buildJev(
  deps: UploadHandlerDeps,
  fetchFn: typeof fetch,
  env: UploadEnv,
  byok: boolean,
): JevClient | null {
  if (byok) return null;
  if (deps.jev !== undefined) return deps.jev;
  if (!env.jevKey) return null;
  return createJevClient({ fetchFn: fetchWithTimeout(fetchFn, JEV_CALL_TIMEOUT_MS), apiKey: env.jevKey, model: UPLOAD_JEV_MODEL });
}

async function ensureAnon(cookieHeader: string | null, secret: string, cookies: string[]): Promise<string> {
  const found = verifyAnonCookie(parseAnonCookie(cookieHeader), secret);
  if (found) return found;
  const issued = issueAnonId(secret);
  cookies.push(serializeAnonCookie(issued.value));
  return issued.id;
}

// Order: same-origin, body cap, strict parse, env, Turnstile, anon cookie,
// BYOK header, then quota (both paths) and spend (free only) inside
// create. User errors never take quota; server failures refund.
export async function handleUploadsCreate(req: Request, deps: UploadHandlerDeps = {}): Promise<Response> {
  const cookies: string[] = [];
  if (rejectsCrossSite(req.headers, req.url)) return fail("bad_request", cookies);
  const capped = await readBodyCapped(req, UPLOAD_MAX_BODY_BYTES);
  if (!capped.ok) return fail("bad_request", cookies);
  let body: UploadCreateBody;
  try {
    body = parseUploadCreate(JSON.parse(capped.text));
  } catch {
    return fail("bad_request", cookies);
  }
  let env = deps.env;
  if (!env) {
    try {
      env = readUploadEnv();
    } catch {
      // fail() logs the one warning; missing names stay out of the log.
      return fail("unavailable", cookies);
    }
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const ip = clientIp(req.headers);
  const human = await checkHuman({
    cookieHeader: req.headers.get("cookie"),
    token: body.turnstileToken,
    ip,
    turnstileSecret: env.turnstileSecret,
    turnstileSiteKey: env.turnstileSiteKey,
    sessionSecret: env.sessionSecret,
    fetchFn,
  });
  if (!human.ok) return fail("human_required", cookies);
  if (human.setCookie) cookies.push(human.setCookie);
  const anonId = await ensureAnon(req.headers.get("cookie"), env.sessionSecret, cookies);
  const byokKey = parseByokHeader(req.headers.get(BYOK_HEADER));
  if (byokKey === false) return fail("bad_request", cookies);
  const meta = buildMeta(deps, fetchFn, byokKey ?? env.metaKey);
  if (!meta) return fail("unavailable", cookies);
  const kv = deps.kv ?? createRestKV(env.upstashUrl, env.upstashToken);
  const day = utcDay(deps.now ?? new Date());
  // BYOK spends the reader's key, so friend codes never apply there.
  // Any other outcome keeps the normal quota; only a boolean travels back.
  const friendAccepted = byokKey
    ? false
    : await acceptFriendCode(
        kv,
        body.friendCode,
        env.friendCodes ?? [],
        friendGuessKeyFor({ day, ip, salt: env.ipSalt, anonId }),
      );
  try {
    const out = await createUpload({
      kv,
      store: deps.store ?? createUploadStore(env.uploadsToken),
      meta,
      body,
      path: byokKey ? "byok" : "free",
      anonId,
      day,
      quotaKeys: bookQuotaKeysFor({ day, ip, salt: env.ipSalt, anonId, ...(byokKey ? { prefix: "upload:byok" } : {}) }),
      spendCapMicro: env.spendCapMicro,
      ...(friendAccepted ? { friendAccepted: true as const } : {}),
    });
    return Response.json(
      { status: "created", id: out.id, chapters: out.chapters, parts: out.parts, friendAccepted },
      { status: 200, headers: withCookies(cookies) },
    );
  } catch (e) {
    if (e instanceof UploadFailure) return fail(e.code, cookies, e.code === "unavailable");
    return fail("unavailable", cookies, true);
  }
}

// Free jobs bind the anon cookie, so another browser cannot drive them;
// BYOK jobs need the key header on every call and never touch our Jev key.
export async function handleUploadStep(req: Request, id: string, deps: UploadHandlerDeps = {}): Promise<Response> {
  const cookies: string[] = [];
  if (!isUploadId(id)) return fail("not_found", cookies);
  if (rejectsCrossSite(req.headers, req.url)) return fail("bad_request", cookies);
  const capped = await readBodyCapped(req, UPLOAD_STEP_BODY_BYTES);
  if (!capped.ok) return fail("bad_request", cookies);
  let chapter: number | undefined;
  let token: string | undefined;
  try {
    ({ chapter, turnstileToken: token } = parseStepBody(capped.text === "" ? {} : JSON.parse(capped.text)));
  } catch {
    return fail("bad_request", cookies);
  }
  let env = deps.env;
  if (!env) {
    try {
      env = readUploadEnv();
    } catch {
      // fail() logs the one warning; missing names stay out of the log.
      return fail("unavailable", cookies);
    }
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const ip = clientIp(req.headers);
  const human = await checkHuman({
    cookieHeader: req.headers.get("cookie"),
    token,
    ip,
    turnstileSecret: env.turnstileSecret,
    turnstileSiteKey: env.turnstileSiteKey,
    sessionSecret: env.sessionSecret,
    fetchFn,
  });
  if (!human.ok) return fail("human_required", cookies);
  if (human.setCookie) cookies.push(human.setCookie);
  const anonId = await ensureAnon(req.headers.get("cookie"), env.sessionSecret, cookies);
  const byokKey = parseByokHeader(req.headers.get(BYOK_HEADER));
  if (byokKey === false) return fail("bad_request", cookies);
  const kv = deps.kv ?? createRestKV(env.upstashUrl, env.upstashToken);
  let job;
  try {
    job = await loadUploadJob(kv, id);
  } catch {
    return fail("unavailable", cookies, true);
  }
  if (!job) return fail("not_found", cookies);
  if (job.path === "free") {
    if (job.anonId === null || anonId !== job.anonId) return fail("not_found", cookies);
  } else if (!byokKey) {
    return fail("bad_request", cookies);
  }
  const byok = job.path === "byok";
  const meta = buildMeta(deps, fetchFn, byok ? (byokKey as string) : env.metaKey);
  if (!meta) return fail("unavailable", cookies);
  try {
    const out = await stepUpload({
      kv,
      store: deps.store ?? createUploadStore(env.uploadsToken),
      meta,
      jev: buildJev(deps, fetchFn, env, byok),
      id,
      ...(chapter === undefined ? {} : { chapter }),
    });
    return Response.json(out, { status: 200, headers: withCookies(cookies) });
  } catch (e) {
    if (e instanceof UploadFailure) return fail(e.code, cookies, e.code === "unavailable");
    return fail("unavailable", cookies, true);
  }
}
