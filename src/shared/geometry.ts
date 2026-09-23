import type { Rect, Settings } from "./types";
// OT v1.0.1 center-cover + output-pixel offsets, adapted to a transparent frame aperture.
// Both the live canvas and Sharp consume these exact integer destinations.
export function photoRect(sw: number, sh: number, g: Settings["geometry"]): Rect {
  if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw <= 0 || sh <= 0)
    throw Error("Invalid source dimensions");
  const r = g.opening,
    scale = Math.max(r.width / sw, r.height / sh) * g.zoom;
  const width = Math.round(sw * scale),
    height = Math.round(sh * scale);
  return {
    x: Math.round(r.x + (r.width - width) / 2 + g.offsetX),
    y: Math.round(r.y + (r.height - height) / 2 + g.offsetY),
    width,
    height,
  };
}
export function drawPhoto(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  rect: Rect,
  mirror: boolean,
) {
  ctx.save();
  if (mirror) {
    ctx.translate(rect.x + rect.width, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0, rect.width, rect.height);
  } else ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

export function cameraGeometry(s: Settings): Settings["geometry"] {
  return {
    ...s.geometry,
    opening: s.previewMode === "full" ? { x: 0, y: 0, ...s.canvas } : s.geometry.opening,
  };
}
export function photoClip(rect: Rect, s: Settings): Rect {
  const opening = cameraGeometry(s).opening;
  const x = Math.max(0, opening.x, rect.x),
    y = Math.max(0, opening.y, rect.y);
  return {
    x,
    y,
    width: Math.max(
      0,
      Math.min(s.canvas.width, opening.x + opening.width, rect.x + rect.width) - x,
    ),
    height: Math.max(
      0,
      Math.min(s.canvas.height, opening.y + opening.height, rect.y + rect.height) - y,
    ),
  };
}
