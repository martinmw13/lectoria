// @vitest-environment jsdom
// Quota failures hide their retry button and point to the key option;
// ordinary failures keep the retry.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { InlineFigureView } from "./inline-figures";
import type { InlineFigure } from "./use-pictures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function figure(over: Partial<InlineFigure>): InlineFigure {
  return {
    id: "f1",
    phase: "error",
    url: null,
    quote: "some quoted passage",
    startN: 1,
    endN: 1,
    credit: "",
    message: "That's all five pictures for today. More tomorrow.",
    ...over,
  };
}

function renderFigure(fig: InlineFigure) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onRetry = vi.fn();
  act(() => {
    root.render(
      <InlineFigureView
        figure={fig}
        onRemove={() => {}}
        onRetry={onRetry}
        onOpen={() => {}}
        refCb={() => {}}
      />,
    );
  });
  return { host, root, onRetry };
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("a quota error hides retry and points to the key option", () => {
  const { host, root } = renderFigure(figure({ quota: true }));
  try {
    const err = host.querySelector(".gen-error");
    expect(err?.textContent).toContain("That's all five pictures");
    expect(err?.querySelector(".retry-text")).toBeNull();
    // The key step for pictures sits under the message.
    expect(host.querySelector(".picture-byok")?.textContent).toContain("Bring your own key!");
    expect(host.querySelector('.picture-byok input[type="password"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
  }
});

test("an ordinary error keeps the retry button", () => {
  const { host, root, onRetry } = renderFigure(
    figure({ quota: false, message: "That picture didn't come out. Try again?" }),
  );
  try {
    const btn = host.querySelector(".gen-error .retry-text");
    expect(btn?.textContent).toBe("Try again");
    act(() => {
      (btn as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
  }
});
