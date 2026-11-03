import type { Metadata } from "next";
import { HomeDefs } from "./home/home-defs";
import { homeFontClass } from "./home/fonts";
import { HomeSpread } from "./home/spread";
import { firstSceneHrefs } from "@/server/books";
import "./home/home.css";
import "./home/home-backdrop.css";
import "./home/home-bring.css";
import "./home/home-plate.css";

export const metadata: Metadata = { title: "Lectoria" };

export default async function Home() {
  const readHrefs = await firstSceneHrefs();
  return (
    <main className={`ob-desk ${homeFontClass}`}>
      <HomeDefs />
      <HomeSpread readHrefs={readHrefs} />
    </main>
  );
}
