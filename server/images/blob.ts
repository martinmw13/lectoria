import "server-only";
import { del, list, put } from "@vercel/blob";
import type { ImageStore } from "@/core/images";

// Blob wrappers. Paths are deterministic and public; routes return URLs,
// never bytes. @vercel/blob reads BLOB_READ_WRITE_TOKEN from env.
const BLOB_TIMEOUT_MS = 8_000;

export interface ImageCleanupStore {
  listAll(prefix: string): Promise<{ pathname: string; uploadedAt: number }[]>;
  remove(path: string): Promise<void>;
}

// Listing for the upload-image sweep only. The default store token holds
// images/u-... paths, never the private uploads token.
export function createImageCleanupStore(): ImageCleanupStore {
  return {
    async listAll(prefix: string): Promise<{ pathname: string; uploadedAt: number }[]> {
      const out: { pathname: string; uploadedAt: number }[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await list({
          prefix,
          limit: 1000,
          ...(cursor ? { cursor } : {}),
          abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
        });
        for (const blob of page.blobs) out.push({ pathname: blob.pathname, uploadedAt: blob.uploadedAt.getTime() });
        if (!page.hasMore) break;
        cursor = page.cursor;
      }
      return out;
    },
    async remove(path: string): Promise<void> {
      await del(path, { abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS) });
    },
  };
}

// Each call fails fast inside the 120 s route budget (Meta takes up to
// 100 s), so a slow Blob still leaves time for the refund and unlock.
export function createBlobStore(): ImageStore {
  return {
    // list stands in for head: a deterministic path has no known URL
    // until the store prefix is resolved, so match the exact pathname.
    async findUrl(path: string): Promise<string | null> {
      const page = await list({ prefix: path, limit: 10, abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS) });
      return page.blobs.find((b) => b.pathname === path)?.url ?? null;
    },
    async save(path: string, bytes: Uint8Array): Promise<string> {
      const blob = await put(path, Buffer.from(bytes), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "image/webp",
        cacheControlMaxAge: 31536000,
        abortSignal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
      });
      return blob.url;
    },
  };
}
