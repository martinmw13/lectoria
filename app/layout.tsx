import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { rootFontClass } from "./fonts";
import { DEFAULT_SKIN, SKIN_SCRIPT } from "./skin";
import { THEME_SCRIPT } from "./theme";
import { WARMTH_SCRIPT } from "./warmth";
import { READING_SCRIPT } from "./reading-prefs";

export const metadata: Metadata = {
  title: "Lectoria",
  description: "A reader that plays orchestral music matched to each scene.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-skin={DEFAULT_SKIN} className={rootFontClass}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SKIN_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: WARMTH_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: READING_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
