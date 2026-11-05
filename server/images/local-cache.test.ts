import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalImageStore,
  handleLocalImageGet,
  isLocalFileName,
  localFileName,
  localImageCacheDir,
  readLocalImage,
} from "./local-cache";

let dir: string;
// Test env objects; NODE_ENV is irrelevant here.
const envOf = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lectoria-img-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const KEY = "images/oz/t1/v3/style-pencil/p12.webp";
const BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);

describe("createLocalImageStore", () => {
  it("misses, saves, then hits from a fresh store over the same dir (restart)", async () => {
    const first = createLocalImageStore(dir);
    expect(await first.findUrl(KEY)).toBeNull();
    const url = await first.save(KEY, BYTES);
    expect(url).toBe(`/api/images/local/${localFileName(KEY)}`);

    const afterRestart = createLocalImageStore(dir);
    expect(await afterRestart.findUrl(KEY)).toBe(url);
    expect(await readLocalImage(dir, localFileName(KEY))).toEqual(BYTES);
  });

  it("keeps different styles of the same scene apart", async () => {
    const store = createLocalImageStore(dir);
    await store.save(KEY, BYTES);
    expect(await store.findUrl(KEY.replace("style-pencil", "style-anime"))).toBeNull();
  });

  it("writes only hash-named files plus metadata, no temp leftovers", async () => {
    await createLocalImageStore(dir).save(KEY, BYTES);
    const hash = localFileName(KEY).replace(".webp", "");
    expect((await readdir(dir)).sort()).toEqual([`${hash}.json`, `${hash}.webp`]);
  });

  it("treats metadata for another key as a miss", async () => {
    const name = localFileName(KEY);
    await writeFile(join(dir, name), BYTES);
    await writeFile(join(dir, name.replace(".webp", ".json")), JSON.stringify({ key: "other" }));
    expect(await createLocalImageStore(dir).findUrl(KEY)).toBeNull();
  });

  it("maps traversal-looking keys to a hash inside the dir", async () => {
    const evil = "../../../etc/passwd";
    const url = await createLocalImageStore(dir).save(evil, BYTES);
    expect(url).toMatch(/^\/api\/images\/local\/[0-9a-f]{64}\.webp$/);
    expect((await readdir(dir)).every((f) => /^[0-9a-f]{64}\.(webp|json)$/.test(f))).toBe(true);
  });
});

describe("served names", () => {
  it("accepts only bare lowercase sha256 .webp names", () => {
    expect(isLocalFileName(localFileName(KEY))).toBe(true);
    for (const bad of [
      "../x.webp",
      `../${localFileName(KEY)}`,
      `${localFileName(KEY).toUpperCase()}`,
      localFileName(KEY).replace(".webp", ".json"),
      `a/${localFileName(KEY)}`,
      "",
    ]) {
      expect(isLocalFileName(bad)).toBe(false);
    }
  });

  it("serves bytes off Vercel and 404s on Vercel or for unsafe names", async () => {
    await createLocalImageStore(dir).save(KEY, BYTES);
    const name = localFileName(KEY);
    const env = envOf({ LECTORIA_IMAGE_CACHE_DIR: dir });

    const ok = await handleLocalImageGet(name, env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(BYTES);

    expect((await handleLocalImageGet(name, envOf({ LECTORIA_IMAGE_CACHE_DIR: dir, VERCEL: "1" }))).status).toBe(404);
    expect((await handleLocalImageGet("../../etc/passwd", env)).status).toBe(404);
    expect((await handleLocalImageGet(name.replace(".webp", ".json"), env)).status).toBe(404);
    expect((await handleLocalImageGet("0".repeat(64) + ".webp", env)).status).toBe(404);
  });
});

describe("localImageCacheDir", () => {
  it("defaults outside the repo under ~/.cache/lectoria/images", () => {
    expect(localImageCacheDir(envOf({}))).toBe(join(homedir(), ".cache", "lectoria", "images"));
  });

  it("honors an absolute override and ignores a relative one", () => {
    expect(localImageCacheDir(envOf({ LECTORIA_IMAGE_CACHE_DIR: dir }))).toBe(dir);
    expect(localImageCacheDir(envOf({ LECTORIA_IMAGE_CACHE_DIR: "../escape" }))).toBe(
      join(homedir(), ".cache", "lectoria", "images"),
    );
  });
});
