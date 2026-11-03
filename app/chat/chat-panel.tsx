"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_QUESTION_CHARS } from "@/core/chat";
import { ByokStep } from "../home/byok";
import { CHAT_COPY } from "./copy";
import { TurnstileWidget } from "../turnstile";
import type { useChat } from "./use-chat";
import { Icon } from "../icons";

type Chat = ReturnType<typeof useChat>;

const COUNTER_FROM = 400;

export function ChatPanel({
  chapter,
  chapterTitle,
  chat,
  suggestions,
  byokKey,
  onKeySubmit,
  onHumanPass,
  onClose,
  prefill = null,
}: {
  chapter: number;
  chapterTitle: string;
  chat: Chat;
  suggestions: string[];
  byokKey: string | null;
  onKeySubmit: (key: string) => void;
  onHumanPass: (token: string) => void;
  onClose: () => void;
  prefill?: { text: string; nonce: number } | null;
}) {
  const [draft, setDraft] = useState("");
  const [spoilAsked, setSpoilAsked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const tryAgainRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const { messages, status, remaining, spoilers, busy } = chat;
  const empty = messages.length === 0 && !chat.byok && !chat.needHuman && status !== "error";

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  // A quote from the selection menu lands in the composer, caret at the end.
  useEffect(() => {
    if (!prefill) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the quote arrives from outside the panel
    setDraft(prefill.text);
    const el = composerRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(prefill.text.length, prefill.text.length));
    }
  }, [prefill]);

  useEffect(() => {
    if (status === "error") tryAgainRef.current?.focus();
  }, [status ]);

  // BYOK state: move focus to the key field.
  useEffect(() => {
    if (!chat.byok) return;
    panelRef.current
      ?.querySelector<HTMLInputElement>('input[name="transient-key"]')
      ?.focus();
  }, [chat.byok]);

  // Auto-scroll only when the reader was already at the bottom.
  useEffect(() => {
    const el = logRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const lastAssistant =
    status === "idle" ? [...messages].reverse().find((m) => m.role === "assistant") : undefined;

  function onToggleSpoilers() {
    if (spoilers) {
      chat.setSpoilers(false);
      setConfirming(false);
      return;
    }
    if (spoilAsked) {
      chat.setSpoilers(true);
      return;
    }
    setConfirming(true);
  }

  function confirmSpoilers(on: boolean) {
    setSpoilAsked(true);
    setConfirming(false);
    if (on) chat.setSpoilers(true);
  }

  function sendDraft() {
    const q = draft.trim();
    if (q === "" || busy) return;
    setDraft("");
    chat.send(q);
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendDraft();
    }
  }

  function onPanelKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    const max = 4 * 20; // Four lines, then scroll.
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }

  return (
    <section
      ref={panelRef}
      className="chat-panel"
      id="chat-panel"
      role="dialog"
      aria-labelledby="chat-panel-title"
      onKeyDown={onPanelKey}
    >
      <div className="chat-head">
        <div className="chat-head-row">
          <h3 id="chat-panel-title">{CHAT_COPY.title}</h3>
          <button type="button" className="chat-x" onClick={onClose} aria-label={CHAT_COPY.closeChat}>
            ×
          </button>
        </div>
        <p className="chat-scope" aria-live="polite">
          {spoilers ? CHAT_COPY.scopeSpoilers : CHAT_COPY.scope(chapter, chapterTitle)}
        </p>
        <button
          type="button"
          className={`chat-switch${spoilers ? " on" : ""}`}
          role="switch"
          aria-checked={spoilers}
          onClick={onToggleSpoilers}
        >
          <span className="chat-switch-track" aria-hidden="true" />
          {CHAT_COPY.spoilers} <small>{spoilers ? CHAT_COPY.spoilersOn : CHAT_COPY.spoilersOff}</small>
        </button>
      </div>

      {confirming && !spoilers && (
        <div className="chat-confirm">
          <span>{CHAT_COPY.spoilerConfirm}</span>
          <button type="button" className="chat-link" onClick={() => confirmSpoilers(true)}>
            {CHAT_COPY.spoilerYes}
          </button>
          <button type="button" className="chat-link" onClick={() => confirmSpoilers(false)}>
            {CHAT_COPY.spoilerNotNow}
          </button>
        </div>
      )}

      <div
        ref={logRef}
        className="chat-log"
        role="log"
        aria-busy={busy}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {empty && (
          <>
            <p className="chat-welcome">{CHAT_COPY.welcome}</p>
            <div className="chat-sugg">
              {suggestions.map((q) => (
                <button key={q} type="button" className="chat-link" onClick={() => chat.send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="chat-q">
              {m.content}
            </div>
          ) : (
            <div key={i} className="chat-a">
              {m.content}
              {busy && i === messages.length - 1 && status === "streaming" && (
                <span className="chat-caret" aria-hidden="true" />
              )}
            </div>
          ),
        )}

        {status === "loading" && (
          <div className="chat-wait">
            {CHAT_COPY.loading}
            <span aria-hidden="true"> ···</span>
          </div>
        )}

        {chat.needHuman && (
          <div className="chat-note">
            {CHAT_COPY.human}
            <TurnstileWidget onToken={onHumanPass} />
          </div>
        )}

        {chat.byok && (
          <div className="chat-note">
            <ByokStep
              note={chat.byok === "quota" ? CHAT_COPY.quotaNote : CHAT_COPY.byokNote}
              privacyNote={CHAT_COPY.byokPrivacy}
              actionLabel={CHAT_COPY.byokAction}
              metaOnly
              onSubmit={onKeySubmit}
            />
          </div>
        )}

        {status === "error" && (
          <div className="chat-note chat-note-error">
            {CHAT_COPY.error}
            <div className="chat-note-actions">
              <button ref={tryAgainRef} type="button" className="chat-link" onClick={() => chat.retry()}>
                {CHAT_COPY.tryAgain}
              </button>
            </div>
          </div>
        )}
      </div>

      <div aria-live="polite" className="sr-only">
        {lastAssistant ? lastAssistant.content : ""}
      </div>

      {spoilers && <div className="chat-spoilrule" aria-hidden="true" />}

      <div className="chat-comp">
        <div className="chat-box">
          <textarea
            ref={composerRef}
            className="chat-ta"
            rows={1}
            value={draft}
            maxLength={CHAT_MAX_QUESTION_CHARS}
            placeholder={CHAT_COPY.placeholder}
            disabled={busy || !!chat.byok}
            aria-label={CHAT_COPY.placeholder}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={onComposerKey}
          />
          {busy ? (
            <button type="button" className="chat-stop" onClick={chat.stop}>
              {CHAT_COPY.stop}
            </button>
          ) : (
            <button
              type="button"
              className="chat-send"
              aria-label={CHAT_COPY.send}
              disabled={draft.trim() === "" || !!chat.byok}
              onClick={sendDraft}
            >
              <Icon name="send" width={20} height={20} />
            </button>
          )}
        </div>
        <div className="chat-foot">
          <span>
            {byokKey ? (
              CHAT_COPY.usingKey
            ) : remaining !== null ? (
              CHAT_COPY.remaining(remaining)
            ) : (
              <>&nbsp;</>
            )}
          </span>
          {draft.length >= COUNTER_FROM && (
            <span aria-hidden="true">{CHAT_MAX_QUESTION_CHARS - draft.length}</span>
          )}
          {messages.length > 0 && (
            <button type="button" className="chat-link chat-startover" onClick={chat.startOver}>
              {CHAT_COPY.startOver}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
