import { handleCastGet } from "@/server/cast";

export const runtime = "nodejs";

// Thin shell: spoiler filtering lives in core/cast.ts, lookup in server/cast.ts.
export async function GET(req: Request): Promise<Response> {
  return handleCastGet(req);
}
