import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Saved lab positions live in .dev/states (gitignored). Local development only.
const DIR = join(process.cwd(), ".dev", "states");
const NAME = /^[\w-]{1,80}$/;
const blocked = () => process.env.NODE_ENV === "production";

export async function GET(request: Request) {
  if (blocked()) return new Response(null, { status: 404 });
  const name = new URL(request.url).searchParams.get("name");
  if (!name) {
    const files = await readdir(DIR).catch(() => [] as string[]);
    return Response.json({ names: files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort() });
  }
  if (!NAME.test(name)) return Response.json({ error: "Names use letters, digits, - and _" }, { status: 400 });
  try {
    return new Response(await readFile(join(DIR, `${name}.json`), "utf8"), { headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: `No saved state "${name}"` }, { status: 404 });
  }
}

export async function POST(request: Request) {
  if (blocked()) return new Response(null, { status: 404 });
  const { name, data } = (await request.json()) as { name?: string; data?: unknown };
  if (!name || !NAME.test(name)) return Response.json({ error: "Names use letters, digits, - and _" }, { status: 400 });
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${name}.json`), JSON.stringify(data, null, 1));
  return Response.json({ ok: true, name });
}
