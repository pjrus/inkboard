const TILE = 128;
const cache = new Map<string, CanvasPattern | null>();
let noise: HTMLCanvasElement | null = null;

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

/** Alpha-only noise, generated once and shared by every colour. */
function noiseTile() {
  if (noise) return noise;
  noise = document.createElement("canvas");
  noise.width = noise.height = TILE;
  const t = noise.getContext("2d")!;
  const img = t.createImageData(TILE, TILE);
  for (let i = 0; i < img.data.length; i += 4) {
    const r = Math.random();
    // Mostly dense with scattered light flecks, like paper tooth.
    img.data[i + 3] = r < 0.25 ? 70 + r * 400 : 190 + r * 65;
  }
  t.putImageData(img, 0, 0);
  return noise;
}

/** Tints the shared noise with `color`: no pixel readback, one draw per colour. */
function makePattern(ctx: CanvasRenderingContext2D, color: string) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = TILE;
  const t = tile.getContext("2d");
  if (!t) return null;
  t.drawImage(noiseTile(), 0, 0);
  t.globalCompositeOperation = "source-in";
  t.fillStyle = color;
  t.fillRect(0, 0, TILE, TILE);
  return ctx.createPattern(tile, "repeat");
}
