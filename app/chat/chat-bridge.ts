import { CHAT_MAX_QUESTION_CHARS } from "@/core/chat";

// The reader's selection menu talks to the chat launcher through one
// window event, so neither component reaches into the other's tree.
export const CHAT_QUOTE_EVENT = "lectoria:chat-quote";

export type QuoteIntent = "explain" | "ask";

export interface QuoteDetail {
  intent: QuoteIntent;
  text: string;
}

const EXPLAIN = (q: string) => `Explain this passage in plain words: “${q}”`;
const ASK = (q: string) => `About “${q}”: `;

// Cut the quote so the whole question fits the chat's character budget.
function fit(quote: string, wrap: (q: string) => string, room: number): string {
  const q = quote.replace(/\s+/g, " ").trim();
  const max = Math.min(room, CHAT_MAX_QUESTION_CHARS - wrap("").length);
  return wrap(q.length <= max ? q : `${q.slice(0, max - 1).trimEnd()}…`);
}

export function quoteQuestion(intent: QuoteIntent, quote: string): string {
  return intent === "explain" ? fit(quote, EXPLAIN, 440) : fit(quote, ASK, 300);
}

export function sendQuoteToChat(intent: QuoteIntent, quote: string) {
  const detail: QuoteDetail = { intent, text: quoteQuestion(intent, quote) };
  window.dispatchEvent(new CustomEvent<QuoteDetail>(CHAT_QUOTE_EVENT, { detail }));
}
