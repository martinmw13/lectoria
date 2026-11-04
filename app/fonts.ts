// The shared next/font faces, set on <html> by the root layout. The home
// adds only its own faces (app/home/fonts.ts). Self-hosted: the CSP
// allows font-src 'self'. No face preloads: the skin is chosen
// client-side, so preloaded fonts would compete with the LCP hero image
// for skins the visitor may never use. display: swap keeps text visible
// in the fallback until each used face arrives.
import {
  Caveat,
  Cormorant_Garamond,
  Crimson_Pro,
  EB_Garamond,
  Fraunces,
  IM_Fell_English,
  IM_Fell_English_SC,
  Instrument_Sans,
  Jost,
  Kalam,
  Lora,
  Newsreader,
  Petit_Formal_Script,
} from "next/font/google";
import { bangersFontClass } from "./home/fonts";

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
  preload: false,
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
  preload: false,
});

// Engraving skin faces. Engraving is the default skin, but it still does
// not preload: the visitor may use another skin, and the hero image wins.
// The skin's tokens fall back to Georgia until they arrive.
const fell = IM_Fell_English({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-fell",
  display: "swap",
  preload: false,
});

const fellSC = IM_Fell_English_SC({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-fell-sc",
  display: "swap",
  preload: false,
});

const garamond = EB_Garamond({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-garamond",
  display: "swap",
  preload: false,
});

// Watercolor skin faces. Like every face here, they load only when a
// page uses them.
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-caveat",
  display: "swap",
  preload: false,
});

const lora = Lora({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-lora",
  display: "swap",
  preload: false,
});

// Ink skin hand for labels and buttons (Caveat and Newsreader are shared).
const kalam = Kalam({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-kalam",
  display: "swap",
  preload: false,
});

// Pencil skin faces: Jost labels, Crimson Pro book, Cormorant titles.
const jost = Jost({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jost",
  display: "swap",
  preload: false,
});

const crimson = Crimson_Pro({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-crimson",
  display: "swap",
  preload: false,
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
  preload: false,
});

// Wordmark faces. Ink signs "LectorIA" in a copperplate pen script, to
// sit with its etching; watercolor in Fraunces' soft italic. Both are
// only the brand line, so one weight each.
const copperplate = Petit_Formal_Script({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-copperplate",
  display: "swap",
  preload: false,
});

const fraunces = Fraunces({
  subsets: ["latin"],
  style: "italic",
  axes: ["SOFT", "opsz"],
  variable: "--font-fraunces",
  display: "swap",
  preload: false,
});

export const rootFontClass =
  `${newsreader.variable} ${instrumentSans.variable} ${fell.variable} ${fellSC.variable} ${garamond.variable} ${caveat.variable} ${lora.variable} ${kalam.variable} ${jost.variable} ${crimson.variable} ${cormorant.variable} ${copperplate.variable} ${fraunces.variable} ${bangersFontClass}`;

