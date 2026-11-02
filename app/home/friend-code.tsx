"use client";

import { useState } from "react";

// Shown once the server confirms the friend code (Spanish copy intended).
export const FRIEND_WELCOME =
  "Hola, escofletudo, te estaba esperando. Mirá cómo te gusta gastarme los créditos. No pinta, amigo. Literalmente una escofleta.";

// One friend-code field for the idle, parsed, and failed screens. The
// code lives in the parent's state only: never stored, never logged.
// Typing one on the BYOK screen flips the route back to the free path.
export function FriendCode({ code, onCode }: { code: string; onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ob-friend">
      {open ? (
        <label className="ob-friendrow" htmlFor="obFriend">
          <span>Friend code</span>
          <input
            id="obFriend"
            className="ob-input"
            type="text"
            value={code}
            onChange={(event) => onCode(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            placeholder="If a friend shared one with you"
          />
        </label>
      ) : (
        <button type="button" className="ob-quiet" onClick={() => setOpen(true)}>
          Have a friend code?
        </button>
      )}
    </div>
  );
}
