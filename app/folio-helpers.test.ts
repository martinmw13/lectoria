// Pure folio helpers: caption truncation, pane split clamp, style pref.
import { describe, expect, it, vi } from "vitest";
import { SKIN_DEFAULT_IMAGE_STYLE } from "@/core/image-style";
import {
  DEFAULT_IMAGE_STYLE,
  STYLE_OTHER_VALUE,
  STYLE_PRESETS,
  effectiveImageStylePref,
  loadImageStylePref,
  migrateLegacyImageStyle,
  parseImageStylePref,
  requestStyleFields,
  resolveStyleSelect,
  saveImageStylePref,
  styleCredit,
} from "./image-style";
import { clampSplitWidth, truncateCaption } from "./folio/helpers";
import { pickEndN, pickStartN } from "./picture-selection";
import type { ParaEntry } from "./picture-selection";

describe("truncateCaption", () => {
  it("leaves a short quote whole", () => {
    expect(truncateCaption("a low wail of the wind")).toBe("a low wail of the wind");
  });

  it("cuts a long quote near 80 chars with an ellipsis", () => {
    const out = truncateCaption(`a ${"very ".repeat(30)}long line`);
    expect(out.length).toBeLessThanOrEqual(81);
    expect(out.endsWith("…")).toBe(true);
  });

  it("collapses whitespace first", () => {
    expect(truncateCaption("  a\n  b ")).toBe("a b");
  });
});

describe("clampSplitWidth", () => {
  it("holds the minimum and the 46vw maximum", () => {
    expect(clampSplitWidth(50, 1280)).toBe(220);
    expect(clampSplitWidth(900, 1280)).toBe(Math.round(1280 * 0.46));
    expect(clampSplitWidth(320, 1280)).toBe(320);
  });
});

describe("pickEndN", () => {
  const entries: ParaEntry[] = [
    { id: "c1p1", n: 1 },
    { id: "c1p2", n: 2 },
    { id: "c1p3", n: 3 },
  ];

  it("picks the later paragraph whatever the drag direction", () => {
    expect(pickEndN(entries, "c1p1", "c1p3")).toBe(3);
    expect(pickEndN(entries, "c1p3", "c1p1")).toBe(3);
  });

  it("agrees with pickStartN inside one paragraph", () => {
    expect(pickEndN(entries, "c1p2", "c1p2")).toBe(pickStartN(entries, "c1p2", "c1p2"));
  });

  it("returns null outside the book", () => {
    expect(pickEndN(entries, null, null)).toBeNull();
    expect(pickEndN(entries, "other", "missing")).toBeNull();
  });
});

describe("parseImageStylePref", () => {
  it("falls back to Denslow on bad or old values", () => {
    expect(parseImageStylePref(null)).toEqual(DEFAULT_IMAGE_STYLE);
    expect(parseImageStylePref({ kind: "preset", id: "nope" })).toEqual(DEFAULT_IMAGE_STYLE);
    expect(parseImageStylePref({ kind: "preset", id: "watercolour" })).toEqual(DEFAULT_IMAGE_STYLE);
    expect(parseImageStylePref({ kind: "preset", id: "gouache" })).toEqual(DEFAULT_IMAGE_STYLE);
    expect(parseImageStylePref({ kind: "custom", text: "  Japanese woodblock " })).toEqual({
      kind: "custom",
      text: "Japanese woodblock",
    });
    expect(parseImageStylePref({ kind: "custom", text: "   " })).toEqual(DEFAULT_IMAGE_STYLE);
  });

  it("round-trips through storage", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
      },
    });
    try {
      saveImageStylePref({ kind: "preset", id: "pencil" });
      expect(loadImageStylePref()).toEqual({ kind: "preset", id: "pencil" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps an explicit pick per skin, so an old Denslow pick never overrides Watercolor", () => {
    const store: Record<string, string> = { "lectoria.imageStyle": JSON.stringify({ kind: "preset", id: "denslow" }) };
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
    });
    try {
      expect(effectiveImageStylePref(loadImageStylePref("watercolor"), "watercolor")).toEqual({ kind: "preset", id: "watercolor" });
      saveImageStylePref({ kind: "preset", id: "denslow" }, "engraving");
      expect(loadImageStylePref("watercolor")).toBeNull();
      expect(loadImageStylePref("engraving")).toEqual({ kind: "preset", id: "denslow" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("moves the old global pick to Engraving only, once", () => {
    const store: Record<string, string> = { "lectoria.imageStyle": JSON.stringify({ kind: "preset", id: "anime" }) };
    const storage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
    vi.stubGlobal("window", { localStorage: storage });
    try {
      expect(loadImageStylePref("watercolor")).toBeNull();
      expect(store["lectoria.imageStyle"]).toBeUndefined();
      expect(loadImageStylePref("engraving")).toEqual({ kind: "preset", id: "anime" });
      expect(requestStyleFields(effectiveImageStylePref(loadImageStylePref("watercolor"), "watercolor"))).toEqual({
        style: { preset: "watercolor" },
      });
      // An Engraving pick of its own is never overwritten by a stale global.
      store["lectoria.imageStyle"] = JSON.stringify({ kind: "preset", id: "comic" });
      migrateLegacyImageStyle(storage);
      expect(loadImageStylePref("engraving")).toEqual({ kind: "preset", id: "anime" });
      // Garbage in the old key is dropped, not migrated.
      store["lectoria.imageStyle"] = "{not json";
      delete store["lectoria.imageStyle.engraving"];
      migrateLegacyImageStyle(storage);
      expect(store["lectoria.imageStyle.engraving"]).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps Other… open until a preset or Escape closes it", () => {
    expect(resolveStyleSelect({ kind: "preset", id: "denslow" }, false)).toBe("denslow");
    expect(resolveStyleSelect({ kind: "preset", id: "denslow" }, true)).toBe(STYLE_OTHER_VALUE);
    expect(resolveStyleSelect({ kind: "custom", text: "Woodblock" }, false)).toBe(
      STYLE_OTHER_VALUE,
    );
  });

  it("caps custom text at 60 chars", () => {
    expect(parseImageStylePref({ kind: "custom", text: ` ${"x".repeat(70)} ` })).toEqual({
      kind: "custom",
      text: "x".repeat(60),
    });
  });
});

describe("loadImageStylePref null and effectiveImageStylePref", () => {
  function stubStorage(store: Record<string, string>) {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
      },
    });
  }

  it("keeps load and parse in agreement", () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    try {
      store["lectoria.imageStyle"] = JSON.stringify({ kind: "preset", id: "pencil" });
      expect(loadImageStylePref()).toEqual(parseImageStylePref({ kind: "preset", id: "pencil" }));
      store["lectoria.imageStyle"] = JSON.stringify({ kind: "custom", text: "crayon drawing" });
      expect(loadImageStylePref()).toEqual(parseImageStylePref({ kind: "custom", text: "crayon drawing" }));
      store["lectoria.imageStyle"] = JSON.stringify({ kind: "preset", id: "nope" });
      expect(loadImageStylePref()).toBeNull();
      expect(parseImageStylePref({ kind: "preset", id: "nope" })).toEqual(DEFAULT_IMAGE_STYLE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when nothing valid is stored", () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    try {
      expect(loadImageStylePref()).toBeNull();
      store["lectoria.imageStyle"] = "{bad json";
      expect(loadImageStylePref()).toBeNull();
      store["lectoria.imageStyle"] = JSON.stringify({ kind: "preset", id: "nope" });
      expect(loadImageStylePref()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves null to denslow with no skin", () => {
    expect(effectiveImageStylePref(null, undefined)).toEqual({ kind: "preset", id: "denslow" });
    expect(effectiveImageStylePref(null, "nope")).toEqual({ kind: "preset", id: "denslow" });
  });

  it("resolves null to the skin default", () => {
    expect(effectiveImageStylePref(null, "watercolor")).toEqual({
      kind: "preset",
      id: "watercolor",
    });
    expect(effectiveImageStylePref(null, "ink")).toEqual({ kind: "preset", id: "pen-pencil" });
  });

  it("lets an explicit pick win and round-trips the request fields", () => {
    const eff = effectiveImageStylePref({ kind: "preset", id: "pencil" }, "watercolor");
    expect(eff).toEqual({ kind: "preset", id: "pencil" });
    expect(requestStyleFields(eff)).toEqual({ style: { preset: "pencil" } });
    const custom = effectiveImageStylePref({ kind: "custom", text: "crayon drawing" }, "ink");
    expect(requestStyleFields(custom)).toEqual({ style: { custom: "crayon drawing" } });
  });

  it("lists every skin default in the picker presets", () => {
    const ids = new Set(STYLE_PRESETS.map((p) => p.id));
    for (const id of Object.values(SKIN_DEFAULT_IMAGE_STYLE)) {
      expect(id).toBeDefined();
      if (id !== undefined) expect(ids.has(id)).toBe(true);
    }
  });
});

describe("requestStyleFields and styleCredit", () => {
  it("sends nothing for Denslow and credits Denslow", () => {
    expect(requestStyleFields({ kind: "preset", id: "denslow" })).toEqual({});
    expect(styleCredit(requestStyleFields({ kind: "preset", id: "denslow" }))).toBe(
      "In the style of W. W. Denslow",
    );
  });

  it("sends the preset id and credits its label", () => {
    expect(requestStyleFields({ kind: "preset", id: "pencil" })).toEqual({
      style: { preset: "pencil" },
    });
    expect(styleCredit(requestStyleFields({ kind: "preset", id: "pencil" }))).toBe("Pencil sketch");
  });

  it("sends custom text and credits it back", () => {
    expect(requestStyleFields({ kind: "custom", text: "crayon drawing" })).toEqual({
      style: { custom: "crayon drawing" },
    });
    expect(styleCredit(requestStyleFields({ kind: "custom", text: "crayon drawing" }))).toBe(
      "crayon drawing",
    );
  });
});
