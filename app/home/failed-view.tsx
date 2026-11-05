"use client";

// The failed-upload step, split out of upload.tsx: each coded error maps
// to its next step (key, friend code, human check, another book).
import { UPLOAD_MESSAGES } from "@/core/uploads";
import { TurnstileWidget } from "../turnstile";
import { ByokStep } from "./byok";
import { FriendCode } from "./friend-code";
import type { FlowCode } from "./upload-flow";

const NETWORK_MESSAGE = "We lost the connection for a moment. Try again?";

// One failed upload: coded errors map to the next step, never a dead end.
export function FailedView({
  status,
  idleKey,
  friendCode,
  friendWelcome,
  onFriendCode,
  onFriendAccepted,
  onRetryKey,
  onRetryToken,
  onRetry,
  onReset,
}: {
  status: { code: FlowCode };
  idleKey: string;
  friendCode: string;
  friendWelcome: boolean;
  onFriendCode: (code: string) => void;
  onFriendAccepted: () => void;
  onRetryKey: (key: string) => void;
  onRetryToken: (token: string) => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  const code = status.code;
  // A spent free book, or one over 50k words, still reads free with a
  // friend's code: the retry sends no key, and the server rules on it.
  if (code === "daily_books_reached" || code === "too_long") {
    return (
      <div>
        <ByokStep
          metaOnly
          note={UPLOAD_MESSAGES[code]}
          initialKey={idleKey}
          actionLabel="Bring your own key!"
          onSubmit={onRetryKey}
        />
        <FriendCode
          code={friendCode}
          onCode={onFriendCode}
          welcome={friendWelcome}
          onAccepted={onFriendAccepted}
        />
        <div className="ob-actions">
          <button
            className="ob-quiet"
            type="button"
            onClick={onRetry}
            disabled={friendCode.trim() === ""}
          >
            Try with friend code
          </button>
          <button className="ob-quiet" type="button" onClick={onReset}>
            Choose another book
          </button>
        </div>
      </div>
    );
  }
  if (code === "daily_budget_reached") {
    return (
      <div>
        <ByokStep
          metaOnly
          note={UPLOAD_MESSAGES[code]}
          initialKey={idleKey}
          actionLabel="Bring your own key!"
          onSubmit={onRetryKey}
        />
        <div className="ob-actions">
          <button className="ob-quiet" type="button" onClick={onReset}>
            Choose another book
          </button>
        </div>
      </div>
    );
  }
  if (code === "human_required") {
    return (
      <div>
        <p className="ob-note">{UPLOAD_MESSAGES.human_required} Complete the check and we&apos;ll pick up where we left off.</p>
        <TurnstileWidget onToken={onRetryToken} />
        <div className="ob-actions">
          <button className="ob-action" type="button" onClick={onRetry}>
            Try again
          </button>
          <button className="ob-quiet" type="button" onClick={onReset}>
            Choose another book
          </button>
        </div>
      </div>
    );
  }
  // Retrying the same file cannot help; only another book can.
  if (code === "too_short") {
    return (
      <div>
        <p className="ob-note" role="alert">
          {UPLOAD_MESSAGES.too_short}
        </p>
        <div className="ob-actions">
          <button className="ob-action" type="button" onClick={onReset}>
            Choose another book
          </button>
        </div>
      </div>
    );
  }
  if (code === "expired" || code === "not_found") {
    return (
      <div>
        <p className="ob-note">{UPLOAD_MESSAGES[code]} Upload it again to start over.</p>
        <div className="ob-actions">
          <button className="ob-action" type="button" onClick={onReset}>
            Upload it again
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="ob-note" role="alert">
        {code === "network" ? NETWORK_MESSAGE : UPLOAD_MESSAGES[code]}
      </p>
      <div className="ob-actions">
        <button className="ob-action" type="button" onClick={onRetry}>
          Try again
        </button>
        <button className="ob-quiet" type="button" onClick={onReset}>
          Choose another book
        </button>
      </div>
    </div>
  );
}
