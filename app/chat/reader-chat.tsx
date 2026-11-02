"use client";

import { useRef, useState } from "react";
import { getReaderKey } from "../leer/reader-key";
import { ChatPanel } from "./chat-panel";
import { CHAT_COPY, CHAT_LABEL } from "./copy";
import { SUGGESTED_QUESTIONS } from "./suggestions";
import { useChat } from "./use-chat";
import { ChatBubble } from "./chat-bubble";

// Launcher + panel shell. Mounted once inside the reader folio; the key it
// holds lives in state only, so reload and panel close clear it. For an
// upload finished with the reader's own key, that key (module memory only)
// asks until the reader types another one.
export function ReaderChat({
  bookId,
  upToN,
  chapter,
  chapterTitle,
}: {
  bookId: string;
  upToN: number;
  chapter: number;
  chapterTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [byokKey, setByokKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  // Closing clears the typed key, so the reader key below returns.
  const effectiveKey = byokKey ?? getReaderKey(bookId);
  const chat = useChat({
    bookId,
    upToN,
    byokKey: effectiveKey,
    turnstileToken,
    onTokenUsed: () => setTurnstileToken(null),
  });

  function close() {
    setOpen(false);
    setByokKey(null); // Memory only: closing forgets the key.
    launcherRef.current?.focus();
  }

  return (
    <div className="reader-chat">
      {open && (
        <ChatPanel
          chapter={chapter}
          chapterTitle={chapterTitle}
          chat={chat}
          suggestions={[...SUGGESTED_QUESTIONS]}
          byokKey={effectiveKey}
          onKeySubmit={(key) => {
            setByokKey(key);
            chat.retry({ key });
          }}
          onHumanPass={(token) => {
            chat.setNeedHuman(false);
            setTurnstileToken(token);
            chat.retry({ token });
          }}
          onClose={close}
        />
      )}
      <button
        ref={launcherRef}
        type="button"
        className="chat-launch"
        aria-expanded={open}
        aria-controls="chat-panel"
        aria-label={open ? CHAT_COPY.closeChat : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="chat-launch-label">{open ? CHAT_COPY.close : CHAT_LABEL}</span>
        <ChatBubble open={open} />
      </button>
    </div>
  );
}
