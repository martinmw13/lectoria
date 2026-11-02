import { useId, useState } from "react";
import { approxPages, FREE_BOOK_MAX_WORDS } from "@/core/upload-policy";

type Provider = "meta" | "openai";

const REASONS: Record<"too_long" | "free_used", (pages: number) => string> = {
  too_long: (pages) => `This one is longer than about ${pages} pages, so it needs your own key.`,
  free_used: () => "You've used your free book for today, so this one needs your own key.",
};

// Key step only: no network call. The key lives in state and is cleared
// on submit, on reset, and on unmount; never stored, logged, or shared.
export function ByokStep({
  reason,
  note,
  privacyNote,
  actionLabel,
  metaOnly,
  initialKey,
  onSubmit,
}: {
  reason?: "too_long" | "free_used";
  note?: string;
  privacyNote?: string;
  actionLabel?: string;
  metaOnly?: boolean;
  initialKey?: string;
  onSubmit: (key: string) => void;
}) {
  const [provider, setProvider] = useState<Provider>("meta");
  const [key, setKey] = useState(initialKey ?? "");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const privacyId = useId();
  const urlId = useId();
  const urlErrorId = useId();
  const freePages = approxPages(FREE_BOOK_MAX_WORDS);

  const urlOk = baseUrl.trim() === "" || /^https:\/\//.test(baseUrl.trim());
  const ready =
    key.trim() !== "" && (provider === "meta" || (urlOk && baseUrl.trim() !== "" && model.trim() !== ""));

  const shownProvider = metaOnly ? "meta" : provider;
  const reasonLine = note ?? (reason ? REASONS[reason](freePages) : "");
  return (
    <div>
      <h3 className="ob-byok-t">Bring your own key!</h3>
      <p className="ob-note">{reasonLine}</p>
      {!metaOnly && (
      <div className="ob-radio-row" role="radiogroup" aria-label="Key provider">
        <label className="ob-radio">
          <input
            type="radio"
            name="byok-provider"
            checked={provider === "meta"}
            onChange={() => setProvider("meta")}
          />
          Meta <span className="ob-tag">Recommended</span>
        </label>
        <label className="ob-radio">
          <input
            type="radio"
            name="byok-provider"
            checked={provider === "openai"}
            onChange={() => setProvider("openai")}
          />
          OpenAI-compatible
        </label>
      </div>
      )}
      {shownProvider === "openai" && (
        <>
          <label className="ob-field" htmlFor={urlId}>
            Base URL
            <input
              id={urlId}
              className="ob-input"
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://"
              aria-invalid={!urlOk}
              aria-describedby={urlOk ? undefined : urlErrorId}
            />
          </label>
          {!urlOk && (
            <p className="ob-error" id={urlErrorId}>
              The base URL needs to start with https://.
            </p>
          )}
          <label className="ob-field">
            Model
            <input
              className="ob-input"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
        </>
      )}
      <label className="ob-field">
        Key
        <input
          className="ob-input"
          type="password"
          name="transient-key"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          aria-describedby={privacyId}
        />
      </label>
      <p className="ob-note" id={privacyId}>
        {privacyNote ??
          "Your key stays in this browser tab. It's never stored on our servers, and it's only used to process this book."}
      </p>
      <div className="ob-actions">
        <button
          className="ob-action"
          type="button"
          disabled={!ready}
          onClick={() => {
            const entered = key;
            setKey("");
            onSubmit(entered);
          }}
        >
          {actionLabel ?? "Read with soundtrack"}
        </button>
      </div>
    </div>
  );
}
