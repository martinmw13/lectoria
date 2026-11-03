// Pregenerate home shelf covers: one portrait cover per shelf book per
// skin, painted in the skin's own image style. Files land as committed
// statics under public/covers/v1 (the versioned path is the cache key),
// plus the manifest module the home reads. Needs only META_API_KEY;
// no Blob or Redis involved, so reruns resume by skipping files on disk.
//
// Run: npm run pregen:covers -- --book all-shelf --style all --dry-run
// Then: npm run shrink:covers (the shelf reads the small copies).
import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { imageCostMicro } from "../core/images";
import { COVER_SKINS } from "../core/cover-prompt";
import {
  parseCapUsd,
  planCoverTasks,
  resolveCoverBooks,
  resolveCoverSkins,
  runCoverTasks,
  type CoverSubject,
} from "../core/cover-pregen";
import { createMetaClient, isPolicyRejection, safeFailureReason } from "../server/images/meta";
import { shelf, shelfById } from "../app/home/shelf";


// Shelf cards are small: keep committed covers web-sized (~60-120 KB).
const COVER_PX = 720;
async function shrinkCover(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes).resize(COVER_PX, COVER_PX, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}

const MANIFEST_PATH = "app/home/cover-manifest.ts";

const USAGE = `usage: pregen-covers.ts [--book <id>|all-shelf] [--style <skin>|all] [--cap <usd>] [--dry-run]
  --book oz         one shelf book (default all-shelf)
  --book all-shelf  all ten shelf books, in shelf order
  --style comic     one skin (default all): ${COVER_SKINS.join(", ")}
  --cap 1.00        max image spend in USD (default 1.00)
  --dry-run         list missing covers plus expected USD, spend nothing`;

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v === undefined || v.startsWith("--") ? undefined : v;
}

function usd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

// Cover subject: the first chapter's cover_description (the book's iconic
// entry moment), else the bookmap setting, else the shelf hook.
function coverSubjectFor(bookId: string): string {
  const shelfBook = shelfById(bookId);
  try {
    const bookmap = JSON.parse(readFileSync(`data/books/${bookId}/bookmap.json`, "utf8")) as {
      chapters?: { ch: number; cover_description?: string }[];
      setting?: { description?: string };
    };
    const chapters = [...(bookmap.chapters ?? [])].sort((a, b) => a.ch - b.ch);
    for (const chapter of chapters) {
      if (typeof chapter.cover_description === "string" && chapter.cover_description.trim() !== "") {
        return chapter.cover_description;
      }
    }
    if (typeof bookmap.setting?.description === "string" && bookmap.setting.description.trim() !== "") {
      return bookmap.setting.description;
    }
  } catch {
    // Missing or unreadable bookmap: fall through to the shelf hook.
  }
  return shelfBook?.hook ?? "";
}

// Names only, never values.
function missingKey(): string | null {
  try {
    if (process.env.META_API_KEY && process.env.META_API_KEY.trim() !== "") return null;
  } catch {
    return "META_API_KEY";
  }
  return "META_API_KEY";
}

async function main(): Promise<void> {
  if (flag("--help") || flag("-h")) {
    console.log(USAGE);
    return;
  }
  const dryRun = flag("--dry-run");

  let bookIds: string[];
  let skins: string[];
  try {
    bookIds = resolveCoverBooks(opt("--book") ?? "all-shelf", shelf.map((b) => b.id));
    skins = resolveCoverSkins(opt("--style") ?? "all", COVER_SKINS);
  } catch (e) {
    console.error(e instanceof Error ? e.message : "unknown argument");
    process.exit(1);
  }

  const subjects: CoverSubject[] = [];
  for (const bookId of bookIds) {
    const book = shelfById(bookId);
    if (!book) {
      console.error(`unknown book: ${bookId}`);
      process.exit(1);
    }
    subjects.push({
      bookId,
      title: book.title,
      author: book.author,
      coverDescription: coverSubjectFor(bookId),
    });
  }

  const { tasks, skipped } = planCoverTasks({
    subjects,
    skins,
    exists: (p) => existsSync(p),
  });
  const cost = imageCostMicro();
  console.log(
    `${tasks.length} missing, ${skipped} cached (${bookIds.length} books x ${skins.length} styles, ~${usd(tasks.length * cost)} at ${usd(cost)}/image)`,
  );
  for (const task of tasks) console.log(`  ${dryRun ? "planned" : "missing"} ${task.skin}/${task.bookId}`);
  if (dryRun || tasks.length === 0) return;

  if (missingKey() && existsSync(".env.local")) {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // Fall through to the missing-key error below.
    }
  }
  if (missingKey()) {
    console.error("missing image env: META_API_KEY");
    process.exit(1);
  }
  const capMicro = Math.round(parseCapUsd(opt("--cap"), 1) * 1_000_000);
  const generate = createMetaClient(process.env.META_API_KEY as string);
  const done: string[] = [];
  const failures: string[] = [];
  const result = await runCoverTasks({
    tasks,
    capMicro,
    costMicro: cost,
    concurrency: 3,
    generate: (prompt) => generate.generate(prompt),
    write: async (diskPath, bytes) => {
      mkdirSync(diskPath.split("/").slice(0, -1).join("/"), { recursive: true });
      writeFileSync(diskPath, await shrinkCover(bytes));
      const task = tasks.find((t) => t.path === diskPath);
      if (task) done.push(`${task.skin}/${task.bookId}`);
    },
    isPolicyRejection,
    onFailure: (task, stage, e) => {
      const why = stage === "write" ? `write ${e instanceof Error ? e.name : "error"}` : safeFailureReason(e);
      failures.push(`${task.skin}/${task.bookId}: ${why}`);
    },
  });
  for (const name of done.sort()) console.log(`  saved ${name}`);
  for (const f of failures.sort()) console.log(`  failed ${f}`);
  refreshManifest();
  console.log(
    `covers: ${result.generated} generated, ${result.failed} failed, ${skipped} cached${result.stoppedAtCap ? ` (stopped: spend cap ${usd(capMicro)} reached)` : ""}`,
  );
  if (result.stoppedAtCap) process.exitCode = 1;
}

// Rebuild the manifest from the files on disk after a run, so the home
// only points at covers that exist.
function refreshManifest(): void {
  const skins: Record<string, Record<string, string>> = {};
  for (const skin of COVER_SKINS) {
    let files: string[] = [];
    try {
      files = readdirSync(`public/covers/v1/${skin}`).filter((f) => f.endsWith(".webp")).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const bookId = file.replace(/\.webp$/, "");
      (skins[skin] ??= {})[bookId] = `/covers/v1/${skin}/${file}`;
    }
  }
  const body = `// Written by \`npm run pregen:covers\`. Do not edit by hand.\nexport const COVER_MANIFEST: Readonly<Record<string, Readonly<Record<string, string>>>> = ${JSON.stringify(skins, null, 2)};\n`;
  mkdirSync("app/home", { recursive: true });
  writeFileSync(MANIFEST_PATH, body);
}

if (process.argv[1]?.endsWith("pregen-covers.ts")) {
  void main();
}
