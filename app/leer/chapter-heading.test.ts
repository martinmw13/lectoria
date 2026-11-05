import { describe, expect, it } from "vitest";
import { chapterHeading } from "./chapter-heading";

describe("chapterHeading", () => {
  it("turns a bare roman numeral (Dracula, Pride, Treasure) into one 'Chapter I' heading", () => {
    expect(chapterHeading("I")).toEqual({ showNumber: false, title: "Chapter I" });
    expect(chapterHeading("xii")).toEqual({ showNumber: false, title: "Chapter XII" });
  });

  it("does not repeat a number the title already carries", () => {
    expect(chapterHeading("Chapter 1")).toEqual({ showNumber: false, title: "Chapter 1" });
    expect(chapterHeading("CHAPTER IV.")).toEqual({ showNumber: false, title: "Chapter IV" });
    expect(chapterHeading(" 7 ")).toEqual({ showNumber: false, title: "Chapter 7" });
  });

  it("keeps the kicker and number for named chapters", () => {
    expect(chapterHeading("The Cyclone")).toEqual({ showNumber: true, title: "The Cyclone" });
    expect(chapterHeading("Letter 1")).toEqual({ showNumber: true, title: "Letter 1" });
    expect(chapterHeading("Note")).toEqual({ showNumber: true, title: "Note" });
    expect(chapterHeading("I Meet a Friend")).toEqual({ showNumber: true, title: "I Meet a Friend" });
  });
});
