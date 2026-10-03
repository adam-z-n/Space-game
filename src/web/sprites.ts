import type { ContentPack } from "../core";

type Sprite = ContentPack["presentation"]["hullSprites"][string];

/** The palette entry that means "this empire's color". */
const EMPIRE = "empire";

/**
 * SVG markup for a pixel-art sprite with its top-left corner at (x, y), each pixel `pixel`
 * units square. Horizontal runs of one color become a single rect to keep the DOM small.
 */
export function spriteMarkup(sprite: Sprite, color: string, x: number, y: number, pixel: number, extra = ""): string {
  const parts: string[] = [];
  sprite.rows.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      const ch = row[c]!;
      let end = c + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== ".") {
        const fill = sprite.palette[ch] === EMPIRE ? color : sprite.palette[ch];
        parts.push(`<rect x="${x + c * pixel}" y="${y + r * pixel}" width="${(end - c) * pixel}" height="${pixel}" fill="${fill}"/>`);
      }
      c = end;
    }
  });
  return `<g shape-rendering="crispEdges"${extra}>${parts.join("")}</g>`;
}

export function spriteSize(sprite: Sprite): { width: number; height: number } {
  return { width: sprite.rows[0]!.length, height: sprite.rows.length };
}

/** A standalone <svg> icon for HTML panels. */
export function spriteIcon(pack: ContentPack, hullId: string, color: string, pixel = 2, dim = false): SVGSVGElement {
  const sprite = pack.presentation.hullSprites[hullId] ?? Object.values(pack.presentation.hullSprites)[0]!;
  const { width, height } = spriteSize(sprite);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(width * pixel));
  svg.setAttribute("height", String(height * pixel));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", `sprite${dim ? " dim" : ""}`);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = spriteMarkup(sprite, color, 0, 0, 1);
  return svg;
}
