// Every reader-facing string for the chat panel in one place.
export const CHAT_LABEL = "Ask the book";

export const CHAT_COPY = {
  title: CHAT_LABEL,
  scope: (ch: number, chapterTitle: string) =>
    `I know the story up to Chapter ${ch}, ${chapterTitle}.`,
  scopeSpoilers: "Spoilers on: I can talk about the whole book.",
  welcome: "Ask me anything about the pages you've read. I'll answer from the book itself.",
  placeholder: "Ask about what you've read…",
  loading: "Looking back through the pages…",
  send: "Send",
  stop: "Stop",
  tryAgain: "Try again",
  close: "Close",
  closeChat: "Close chat",
  resize: "Resize chat (drag, or use the arrow keys)",
  spoilers: "Spoilers",
  spoilerConfirm: "This can give away the ending. Turn spoilers on?",
  spoilerYes: "Yes",
  spoilerNotNow: "Not now",
  error: "Something went wrong on our side. Your question is safe, try again in a moment.",
  human: "One quick check that you're a person.",
  quotaNote: "That's your 15 questions for today. With your Meta key you can keep asking.",
  byokNote: "Our free questions are used up for now. With your Meta key you can keep asking.",
  byokPrivacy: "Your key stays in this tab's memory. We never store or log it.",
  byokAction: "Keep asking",
  byokKey: "Bring your own key!",
  usingKey: "Using your key",
  remaining: (n: number) => `${n} questions left today`,
  startOver: "Start over",
  answerAnnounced: "Answer finished.",
} as const;
