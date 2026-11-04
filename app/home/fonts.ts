// Display fonts for the home spread only (comic and chihiro). The other
// skins' faces come from app/fonts.ts on <html>. Self-hosted: the CSP
// allows font-src 'self'. Body text stays on var(--font-book). No
// preloads: they would compete with the LCP hero image.
import { Bangers, Comic_Neue, Klee_One } from "next/font/google";

const bangers = Bangers({ subsets: ["latin"], weight: "400", variable: "--font-bangers", display: "swap", preload: false });
const comicNeue = Comic_Neue({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-comic-neue", display: "swap", preload: false });
const klee = Klee_One({ subsets: ["latin"], weight: "600", variable: "--font-klee", display: "swap", preload: false });

export const homeFontClass = `${bangers.variable} ${comicNeue.variable} ${klee.variable}`;

// The reader's comic wordmark letters "LectorIA" in Bangers too, so the
// root layout carries this one variable (app/fonts.ts).
export const bangersFontClass = bangers.variable;
