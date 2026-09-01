import { json } from "@/lib/http";
import { publicStatus } from "@/lib/dr";

/** Public status — no paths, dumps, keys, or user data. */
export async function GET() {
  return json(await publicStatus(), 200, { "Cache-Control": "public, max-age=5" });
}
