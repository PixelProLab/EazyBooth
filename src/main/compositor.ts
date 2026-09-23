import sharp, { type OverlayOptions } from "sharp";
import { photoRect, cameraGeometry, photoClip } from "../shared/geometry";
import type { Settings } from "../shared/types";
export async function frameOpening(file: string) {
  const { data, info } = await sharp(file, { limitInputPixels: 24000000 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let x = info.width,
    y = info.height,
    right = -1,
    bottom = -1;
  for (let row = 0; row < info.height; row++)
    for (let col = 0; col < info.width; col++) {
      if (data[(row * info.width + col) * 4 + 3] < 255) {
        x = Math.min(x, col);
        y = Math.min(y, row);
        right = Math.max(right, col);
        bottom = Math.max(bottom, row);
      }
    }
  if (right < 0) throw Error("Frame has no transparency");
  return { x, y, width: right - x + 1, height: bottom - y + 1 };
}
sharp.cache(false);
sharp.concurrency(2);
export async function checkAsset(
  file: string,
  frame: boolean,
  canvas = { width: 1800, height: 1200 },
) {
  const source = sharp(file, { limitInputPixels: 24000000, animated: false });
  const meta = await source.metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format || "") || (meta.pages || 1) > 1)
    throw Error("Use a still PNG, JPEG or WebP image");
  if (
    frame &&
    (meta.format !== "png" ||
      meta.width !== canvas.width ||
      meta.height !== canvas.height ||
      !meta.hasAlpha)
  )
    throw Error(`Frame must be a transparent ${canvas.width} × ${canvas.height} PNG`);
  const { data, info } = await source
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (frame) {
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
    if (transparent < info.width * info.height * 0.01)
      throw Error("Frame has no usable transparent opening");
  }
  return meta;
}
export async function composite(
  original: Buffer,
  s: Settings,
  resolve: (p: string) => string,
) {
  const meta = await sharp(original, { limitInputPixels: 24000000 }).metadata();
  const rect = photoRect(meta.width!, meta.height!, cameraGeometry(s));
  if (rect.width * rect.height > 64000000)
    throw Error("Calibration exceeds composition memory budget");
  const clip = photoClip(rect, s),
    layers: OverlayOptions[] = [];
  if (s.previewMode === "branded") {
    await checkAsset(resolve(s.background), false);
    const background = await sharp(resolve(s.background))
      .rotate()
      .resize(s.canvas.width, s.canvas.height, { fit: "fill" })
      .png()
      .toBuffer();
    layers.push({ input: background, left: 0, top: 0 });
  }
  if (clip.width && clip.height) {
    const image = await sharp(original)
      .flop(s.geometry.outputMirror)
      .resize(rect.width, rect.height, { fit: "fill" })
      .png()
      .toBuffer();
    const clipped = await sharp(image)
      .extract({
        left: clip.x - rect.x,
        top: clip.y - rect.y,
        width: clip.width,
        height: clip.height,
      })
      .png()
      .toBuffer();
    layers.push({ input: clipped, left: clip.x, top: clip.y });
  }
  if (s.frameMode === "overlay") {
    await checkAsset(resolve(s.frame), true, s.canvas);
    layers.push({ input: resolve(s.frame), left: 0, top: 0 });
  }
  return sharp({ create: { ...s.canvas, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .withMetadata({ density: 300 })
    .jpeg({ quality: 98, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
