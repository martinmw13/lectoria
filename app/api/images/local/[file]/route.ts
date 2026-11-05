import { handleLocalImageGet } from "@/server/images/local-cache";

export const runtime = "nodejs";

// Localhost-only picture bytes from the disk cache; 404 on Vercel.
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await ctx.params;
  return handleLocalImageGet(file);
}
