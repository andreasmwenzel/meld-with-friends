import { PRESETS } from "@/engine/scenarios";

// The lab's named positions as JSON, for scripts/overlap.mjs: the real exported list, not a parse of the source.
// Local development only.
export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  return Response.json(PRESETS.map(({ id, group, title, spec, view }) => ({ id, group, title, spec, view: view ?? 0 })));
}
