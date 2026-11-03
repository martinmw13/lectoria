"use client";

import { useState } from "react";

// Shown once the server confirms the friend code (Spanish copy intended).
export const FRIEND_WELCOME =
  "Hola, escofletudo, te estaba esperando. Mirá cómo te gusta gastarme los créditos. No pinta, amigo. Literalmente una escofleta.";

export type FriendCheck = "ok" | "wrong" | "unavailable";

// One instant check against the server. "ok" only for a 200 with ok ===
// true; "wrong" for a 200 or 400 answer saying no; "unavailable" for a
// 5xx, rate limit, or network error, so a server hiccup never reads as a
// bad code. Never logs the code.
export async function checkFriendCode(code: string, fetchFn: typeof fetch = fetch): Promise<FriendCheck> {
  try {
    const res = await fetchFn("/api/uploads/friend-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.status === 400) return "wrong";
    if (res.status !== 200) return "unavailable";
    const json: unknown = await res.json();
    return typeof json === "object" && json !== null && (json as { ok?: unknown }).ok === true ? "ok" : "wrong";
  } catch {
    return "unavailable";
  }
}

// One friend-code field for the idle, parsed, and failed screens. The
// code lives in the parent's state only: never stored, never logged.
// Applying one the server accepts flips the BYOK route back to free.
// Enter applies the code without submitting anything: there is no form
// here, and preventDefault keeps it from reaching any file picker.
export function FriendCode({
  code,
  onCode,
  welcome = false,
  onAccepted,
}: {
  code: string;
  onCode: (code: string) => void;
  welcome?: boolean;
  onAccepted?: () => void;
}) {
  // A code typed on an earlier screen keeps the field open here.
  const [open, setOpen] = useState(code !== "");
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState<"wrong" | "unavailable" | null>(null);
  const empty = code.trim() === "";
  async function apply() {
    if (empty || checking) return;
    setChecking(true);
    const result = await checkFriendCode(code);
    setChecking(false);
    setFailed(result === "ok" ? null : result);
    if (result === "ok") onAccepted?.();
  }
  return (
    <div className="ob-friend">
      {open ? (
        <div>
          <div className="ob-friendrow">
            <label htmlFor="obFriend">Friend code</label>
            <input
              id="obFriend"
              className="ob-input"
              type="text"
              value={code}
              onChange={(event) => {
                onCode(event.target.value);
                setFailed(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void apply();
                }
              }}
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              placeholder="If a friend shared one with you"
            />
            <button
              type="button"
              className="ob-quiet"
              disabled={empty || checking}
              onClick={() => void apply()}
            >
              {checking ? "Checking…" : "Apply"}
            </button>
          </div>
          {failed && (
            <p className="ob-fine" role="status">
              {failed === "wrong"
                ? "That code didn't work."
                : "We couldn't check that code right now. Try again?"}
            </p>
          )}
          {welcome && (
            <p className="ob-friend-ok" role="status">
              {FRIEND_WELCOME}
            </p>
          )}
        </div>
      ) : (
        <button type="button" className="ob-quiet" onClick={() => setOpen(true)}>
          Have a friend code?
        </button>
      )}
    </div>
  );
}
