// Small shelf covers: a ~320 px webp copy of every committed cover in
// public/covers/v1/<skin>/, written to <skin>/sm/<file>. Local only, no
// network. Rerun after pregen:covers repaints a cover.
//
// Run: npm run shrink:covers
import sharp from "sharp";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "public/covers/v1";
const SMALL_PX = 320;

async function main(): Promise<void> {
  let count = 0;
  let before = 0;
  let after = 0;
  for (const skin of readdirSync(ROOT).sort()) {
    const dir = join(ROOT, skin);
    if (!statSync(dir).isDirectory()) continue;
    const out = join(dir, "sm");
    mkdirSync(out, { recursive: true });
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".webp")) continue;
      const src = join(dir, file);
      const dest = join(out, file);
      await sharp(src)
        .resize(SMALL_PX, SMALL_PX, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 76 })
        .toFile(dest);
      before += statSync(src).size;
      after += statSync(dest).size;
      count += 1;
    }
  }
  console.log(`shrink:covers wrote ${count} covers, ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB`);
}

main().catch((e: unknown) => {
  console.error("shrink:covers failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
