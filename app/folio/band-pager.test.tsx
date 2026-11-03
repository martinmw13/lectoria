/**
 * @vitest-environment jsdom
 */
import { expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BandPager } from "./chrome";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

it("draws a 1000-scene book as one fill plus chapter marks", () => {
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() =>
    root.render(
      <BandPager k={1} n={10} bookIndex={249} bookTotal={1000} onPrev={() => {}} onNext={() => {}} atStart={false} atBookEnd={false} chapterStarts={[0, 500]} />,
    ),
  );
  const ticks = el.querySelector(".ticks")!;
  expect(ticks.children).toHaveLength(3);
  expect((ticks.querySelector(".tk-fill") as HTMLElement).style.width).toBe("25%");
  expect((ticks.querySelector(".tk-ch") as HTMLElement).style.left).toBe("50%");
  act(() => root.unmount());
});
