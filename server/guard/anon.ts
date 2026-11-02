import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ANON_COOKIE = "img_anon";

function sign(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("hex");
}

export function issueAnonId(secret: string): { id: string; value: string } {
  const id = randomBytes(16).toString("hex");
  return { id, value: `${id}.${sign(id, secret)}` };
}

// Returns the id when the signature matches, else null. Compare runs in
// constant time so a forged cookie reveals nothing about the secret.
export function verifyAnonCookie(value: string | null | undefined, secret: string): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(id, secret);
  if (sig.length !== expected.length) return null;
  const ok = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? id : null;
}

export function parseAnonCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === ANON_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

export function serializeAnonCookie(value: string): string {
  return `${ANON_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

// The id behind the anon cookie, issuing and setting one when the request
// has none valid. The id itself is never logged.
export function ensureAnon(cookieHeader: string | null, secret: string, cookies: string[]): string {
  const found = verifyAnonCookie(parseAnonCookie(cookieHeader), secret);
  if (found) return found;
  const issued = issueAnonId(secret);
  cookies.push(serializeAnonCookie(issued.value));
  return issued.id;
}
