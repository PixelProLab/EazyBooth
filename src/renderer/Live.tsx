import { useEffect, useRef } from "react";
import { drawPhoto, photoRect, cameraGeometry, photoClip } from "../shared/geometry";
import type { Settings } from "../shared/types";
export function Live({
  video,
  settings,
  active,
  onReady,
  onError,
}: {
  video: HTMLVideoElement | null;
  settings: Settings;
  active: boolean;
  onReady: () => void;
  onError: (s: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  useEffect(() => {
    if (!active || !video) return;
    let stopped = false,
      raf = 0,
      last = 0,
      ready = false;
    const frame = new Image(),
      background = new Image();
    const load = (image: HTMLImageElement, file: string) => {
      image.src = window.booth.media(file);
      return image.decode();
    };
    Promise.all([
      settings.frameMode === "overlay" ? load(frame, settings.frame) : Promise.resolve(),
      settings.previewMode === "branded"
        ? load(background, settings.background)
        : Promise.resolve(),
    ])
      .then(() => {
        if (stopped) return;
        const c = canvas.current!;
        const width = Math.min(
          1200,
          settings.camera.previewWidth,
          (settings.camera.previewHeight * settings.canvas.width) /
            settings.canvas.height,
        );
        c.width = width;
        c.height = Math.round((width * settings.canvas.height) / settings.canvas.width);
        const ctx = c.getContext("2d")!;
        const render = (now: number) => {
          if (stopped) return;
          raf = requestAnimationFrame(render);
          if (now - last < 50) return;
          last = now;
          if (!video.videoWidth || video.readyState < 2) return;
          const { width: w, height: h } = settings.canvas;
          ctx.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
          if (settings.previewMode === "branded") ctx.drawImage(background, 0, 0, w, h);
          const rect = photoRect(
            video.videoWidth,
            video.videoHeight,
            cameraGeometry(settings),
          );
          const clip = photoClip(rect, settings);
          ctx.save();
          ctx.beginPath();
          ctx.rect(clip.x, clip.y, clip.width, clip.height);
          ctx.clip();
          drawPhoto(ctx, video, rect, settings.geometry.previewMirror);
          ctx.restore();
          if (settings.frameMode === "overlay") ctx.drawImage(frame, 0, 0, w, h);
          if (!ready) {
            ready = true;
            callbacks.current.onReady();
          }
        };
        raf = requestAnimationFrame(render);
      })
      .catch(() => {
        if (!stopped)
          callbacks.current.onError(
            "Frame artwork could not load. Ask the operator to select a valid frame.",
          );
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      frame.src = "";
      background.src = "";
      if (canvas.current) {
        canvas.current.width = 0;
        canvas.current.height = 0;
      }
    };
  }, [video, settings, active]);
  return (
    <canvas
      ref={canvas}
      className="photo"
      style={{ aspectRatio: `${settings.canvas.width}/${settings.canvas.height}` }}
      aria-label="Live framed camera preview"
    />
  );
}
