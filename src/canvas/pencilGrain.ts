const TILE = 128;
const cache = new Map<string, CanvasPattern | null>();

/**
 * Fill style that makes a pencil stroke look like graphite on paper: the
 * stroke colour with a speckled alpha, so paper "shows through" the grain.
 * The tile is anchored in world space, so grain stays put as you pan and zoom.
 */
export function pencilFill(
  ctx: CanvasRenderingContext2D,
  color: string,
): string | CanvasPattern {
  let pattern = cache.get(color);
  if (pattern === undefined) {
    pattern = makePattern(ctx, color);
    cache.set(color, pattern);
  }
  return pattern ?? color;
}

function makePattern(ctx: CanvasRenderingContext2D, color: string) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = TILE;
  const t = tile.getContext("2d");
  if (!t) return null;
  // Draw the colour once so the browser parses it (any CSS colour works),
  // then rewrite only the alpha channel with noise.
  t.fillStyle = color;
  t.fillRect(0, 0, TILE, TILE);
  const img = t.getImageData(0, 0, TILE, TILE);
  for (let i = 3; i < img.data.length; i += 4) {
    const r = Math.random();
    // Mostly dense with scattered light flecks, like paper tooth.
    img.data[i] = r < 0.25 ? 70 + r * 400 : 190 + r * 65;
  }
  t.putImageData(img, 0, 0);
  return ctx.createPattern(tile, "repeat");
}
