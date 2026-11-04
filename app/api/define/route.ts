import { handleDefineGet } from "@/server/dictionary";

export const runtime = "nodejs";

// Thin shell: validation, caching and the upstream call live in server/dictionary.ts.
export async function GET(req: Request): Promise<Response> {
  return handleDefineGet(req);
}
