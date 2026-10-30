/** The table's look: its cloth and the pattern on the card backs. Plain constants, so the root layout can use them. */

/** Where card and table options are kept on this browser (src/lib/cardPrefs.ts). */
export const CARD_PREFS_KEY = "meld.cards";

/** The table's cloth. Each sets --cloth, --cloth-deep and --cloth-edge (globals.css, `html[data-cloth]`). */
export type Cloth = "oxblood" | "baize" | "navy" | "slate" | "plum" | "walnut";
/** [id, name, swatch]: the swatch is the cloth's main colour, for the picker and the phone's status bar. */
export const CLOTHS: [Cloth, string, string][] = [
  ["oxblood", "Oxblood", "#5b1d25"], ["baize", "Baize", "#1f4a36"], ["navy", "Navy", "#1d2a48"],
  ["slate", "Slate", "#2f3337"], ["plum", "Plum", "#43243f"], ["walnut", "Walnut", "#4a3223"],
];
/** The pattern on the backs. The colour always says the team. */
export type Back = "lattice" | "stripes" | "rosette" | "monogram";
export const BACKS: [Back, string][] = [["lattice", "Lattice"], ["stripes", "Stripes"], ["rosette", "Rosette"], ["monogram", "Monogram"]];

/**
 * Runs in the page's head before it paints, so a chosen cloth never flashes oxblood first, and follows a change made
 * in another tab (including clearing the site's storage). It also writes the phone's theme-color tag. Kept to plain ES5 and standalone: it cannot import anything.
 */
export const CLOTH_SCRIPT = `(function(){var s=${JSON.stringify(Object.fromEntries(CLOTHS.map(([c, , hex]) => [c, hex])))};
function a(){var c="oxblood";try{c=JSON.parse(localStorage.getItem(${JSON.stringify(CARD_PREFS_KEY)})||"{}").cloth||c}catch(e){}
if(!Object.prototype.hasOwnProperty.call(s,c))c="oxblood";document.documentElement.setAttribute("data-cloth",c);
var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.name="theme-color";document.head.appendChild(m)}
m.setAttribute("content",s[c])}
a();addEventListener("storage",function(e){if(e.key===null||e.key===${JSON.stringify(CARD_PREFS_KEY)})a()})})()`;
