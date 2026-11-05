import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { ImageStore } from "@/core/images";

// Disk-backed ImageStore for localhost only. The cache lives outside the
// repo (default ~/.cache/lectoria/images) so a rebuild script's
// git checkout, reset, or clean -x never wipes it. File names are a
// sha256 of the cache key, so no request field ever reaches the path.
// turbopackIgnore keeps these runtime paths out of output file tracing.

export const LOCAL_IMAGE_ROUTE = "/api/images/local";
const NAME_RE = /^[0-9a-f]{64}\.webp$/;

export interface LocalImageMeta {
  key: string;
  contentType: "image/webp";
  bytes: number;
  createdAt: string;
}

// True on any Vercel deployment (Vercel sets VERCEL=1 in build and runtime).
export function onVercel(from: NodeJS.ProcessEnv): boolean {
  return (from.VERCEL ?? "") !== "";
}

// LECTORIA_IMAGE_CACHE_DIR wins when absolute; anything else is ignored.
export function localImageCacheDir(from: NodeJS.ProcessEnv = process.env): string {
  const override = from.LECTORIA_IMAGE_CACHE_DIR?.trim() ?? "";
  if (override !== "" && isAbsolute(override)) return resolve(/*turbopackIgnore: true*/ override);
  return join(/*turbopackIgnore: true*/ homedir(), ".cache", "lectoria", "images");
}

export function localFileName(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.webp`;
}

export function isLocalFileName(name: string): boolean {
  return NAME_RE.test(name);
}

// Resolves a served name inside dir, or null for anything that is not a
// bare hash name (traversal, separators, other extensions).
function safePath(dir: string, name: string): string | null {
  if (!isLocalFileName(name)) return null;
  const root = resolve(/*turbopackIgnore: true*/ dir);
  const full = resolve(/*turbopackIgnore: true*/ root, name);
  return full.startsWith(root + sep) ? full : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(/*turbopackIgnore: true*/ path)).isFile();
  } catch {
    return false;
  }
}

async function readMeta(path: string): Promise<LocalImageMeta | null> {
  try {
    const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ path, "utf8")) as Partial<LocalImageMeta>;
    return typeof parsed.key === "string" ? (parsed as LocalImageMeta) : null;
  } catch {
    return null;
  }
}

// Write-then-rename so a crash never leaves a half file under the real name.
async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, data);
  await rename(/*turbopackIgnore: true*/ tmp, path);
}

export function createLocalImageStore(dir: string): ImageStore {
  const urlFor = (name: string): string => `${LOCAL_IMAGE_ROUTE}/${name}`;
  return {
    // A hit needs the image and its metadata (written last) with the same key.
    async findUrl(key: string): Promise<string | null> {
      const name = localFileName(key);
      const file = safePath(dir, name);
      if (!file) return null;
      const meta = await readMeta(file.replace(/\.webp$/, ".json"));
      if (!meta || meta.key !== key || !(await exists(file))) return null;
      return urlFor(name);
    },
    async save(key: string, bytes: Uint8Array): Promise<string> {
      const name = localFileName(key);
      const file = safePath(dir, name);
      if (!file) throw new Error("bad local image name");
      await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
      await writeAtomic(file, bytes);
      const meta: LocalImageMeta = {
        key,
        contentType: "image/webp",
        bytes: bytes.byteLength,
        createdAt: new Date().toISOString(),
      };
      await writeAtomic(file.replace(/\.webp$/, ".json"), JSON.stringify(meta));
      return urlFor(name);
    },
  };
}

// Bytes for one served name, or null when the name is unsafe or absent.
export async function readLocalImage(dir: string, name: string): Promise<Uint8Array | null> {
  const file = safePath(dir, name);
  if (!file) return null;
  try {
    return new Uint8Array(await readFile(/*turbopackIgnore: true*/ file));
  } catch {
    return null;
  }
}

// GET handler for the local route. Never serves on Vercel.
export async function handleLocalImageGet(
  name: string,
  from: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  if (onVercel(from)) return new Response("Not found", { status: 404 });
  const bytes = await readLocalImage(localImageCacheDir(from), name);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
