// Generates PWA icons from src/app/icon.svg. Run: node scripts/generate-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("src/app/icon.svg", "utf8");
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
// Drop the rounded background rect; full-bleed variants draw their own.
const art = inner.replace(/<rect width="64" height="64"[^>]*\/>/, "");
const CLOTH = "#5b1d25";

// Full-bleed cloth square with the artwork scaled about the centre.
const bleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${CLOTH}"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${art}</g></svg>`;

const out = async (markup, size, file) =>
  sharp(Buffer.from(markup), { density: 384 }).resize(size, size).png().toFile(`public/icons/${file}`);

for (const s of [192, 512]) {
  await out(svg, s, `icon-${s}.png`); // "any": rounded, as-is
  await out(bleed(0.72), s, `maskable-${s}.png`); // content within central 80%
}
await out(bleed(0.9), 180, "apple-touch-icon.png"); // opaque, iOS rounds corners

// favicon.ico (16/32/48, PNG-embedded). Small sizes use a simplified, bolder
// variant of the same artwork so the suit marks stay legible in a browser tab.
const font = "Didot, 'Bodoni MT', 'Bodoni Moda', serif";
const tab = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${CLOTH}"/><g transform="translate(32 32) scale(1.18) translate(-32 -32)"><rect x="12" y="10" width="30" height="44" rx="4" fill="#f5efe3" transform="rotate(-8 29 31)"/><rect x="22" y="12" width="30" height="42" rx="4" fill="#f5efe3" stroke="${CLOTH}" stroke-width="2" transform="rotate(8 37 33)"/><text x="39" y="45" text-anchor="middle" font-family="${font}" font-size="32" fill="#c1272d" transform="rotate(8 37 33)">&#9830;</text><text x="25" y="38" text-anchor="middle" font-family="${font}" font-size="28" fill="#1c1a19" transform="rotate(-8 29 31)">&#9824;</text></g></svg>`;
const sizes = [16, 32, 48];
const pngs = await Promise.all(
  sizes.map((s) => sharp(Buffer.from(tab), { density: 768 }).resize(s, s).png({ compressionLevel: 9 }).toBuffer()),
);
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s;
  e[1] = s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([head, ...dir, ...pngs]));
