import { handleFriendCodeCheck } from "@/server/uploads/friend-code";

export const runtime = "nodejs";

// Thin shell: the order of operations lives in
// server/uploads/friend-code.ts so tests skip the network.
export async function POST(req: Request): Promise<Response> {
  return handleFriendCodeCheck(req);
}
