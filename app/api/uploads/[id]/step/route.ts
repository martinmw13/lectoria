import { handleUploadStep } from "@/server/uploads/handler";

export const runtime = "nodejs";
export const maxDuration = 120;

// Thin shell: the full order of operations lives in
// server/uploads/handler.ts so tests skip the network.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleUploadStep(req, id);
}
