// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { Camera } from "../src/renderer/camera";
import { defaults } from "../src/shared/settings";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("times out an unresponsive driver and stops its late stream", async () => {
  vi.useFakeTimers();
  const f = fixture(),
    c = new Camera();
  let resolve!: (value: unknown) => void;
  f.getUserMedia.mockImplementation(() => new Promise((r) => (resolve = r)) as any);
  const pending = c.open(f.video, { ...defaults("/tmp").camera, deviceId: "sony" });
  const checked = expect(pending).rejects.toThrow("12 seconds");
  await vi.advanceTimersByTimeAsync(12000);
  await checked;
  resolve(f.stream);
  await Promise.resolve();
  await Promise.resolve();
  expect(f.track.stop).toHaveBeenCalledTimes(1);
});
function fixture() {
  const track = Object.assign(new EventTarget(), {
    readyState: "live",
    muted: false,
    label: "Sony Camera (Imaging Edge)",
    stop: vi.fn(),
    getSettings: () => ({ width: 1024, height: 576 }),
    getCapabilities: () => ({}),
  });
  const stream = {
    active: true,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: async () => [
        { kind: "videoinput", deviceId: "sony", label: track.label },
      ],
    },
  });
  const video = document.createElement("video");
  video.play = vi.fn(async () => {});
  Object.defineProperty(video, "videoWidth", { value: 1024 });
  Object.defineProperty(video, "videoHeight", { value: 576 });
  Object.defineProperty(video, "readyState", { value: 4 });
  return { track, stream, getUserMedia, video };
}
it("coalesces opens and retains one stream for retake", async () => {
  const f = fixture(),
    c = new Camera(),
    cfg = defaults("/tmp").camera;
  const a = c.open(f.video, cfg),
    b = c.open(f.video, cfg);
  expect(a).toBe(b);
  await a;
  await c.open(f.video, cfg);
  expect(f.getUserMedia).toHaveBeenCalledTimes(1);
  expect(c.info().actual.width).toBe(1024);
  c.stop();
  expect(f.track.stop).toHaveBeenCalledTimes(1);
});
it("stops a permission response that resolves after reset", async () => {
  const f = fixture(),
    c = new Camera();
  let resolve!: (s: unknown) => void;
  f.getUserMedia.mockImplementation(() => new Promise((r) => (resolve = r)) as any);
  const p = c.open(f.video, { ...defaults("/tmp").camera, deviceId: "sony" });
  c.stop();
  resolve(f.stream);
  await expect(p).rejects.toThrow("cancelled");
  expect(f.track.stop).toHaveBeenCalledTimes(1);
  expect(f.video.srcObject).toBeNull();
});
it("detects disconnect, cleans watchers and can reconnect", async () => {
  const f = fixture(),
    c = new Camera();
  c.onFault = vi.fn();
  await c.open(f.video, defaults("/tmp").camera);
  f.track.dispatchEvent(new Event("ended"));
  expect(c.onFault).toHaveBeenCalledTimes(1);
  c.stop();
  f.track.dispatchEvent(new Event("ended"));
  expect(c.onFault).toHaveBeenCalledTimes(1);
  await c.open(f.video, defaults("/tmp").camera);
  expect(f.getUserMedia).toHaveBeenCalledTimes(2);
  c.stop();
});
it("detects no advancing frames without comparing scene pixels", async () => {
  vi.useFakeTimers();
  const f = fixture(),
    c = new Camera();
  c.onFault = vi.fn();
  await c.open(f.video, defaults("/tmp").camera);
  vi.advanceTimersByTime(11000);
  expect(c.onFault).toHaveBeenCalledTimes(1);
  c.stop();
});
it("fails missing Sony selection without switching to laptop", async () => {
  const f = fixture();
  navigator.mediaDevices.enumerateDevices = async () => [
    {
      kind: "videoinput",
      deviceId: "laptop",
      label: "Integrated webcam",
    } as MediaDeviceInfo,
  ];
  const c = new Camera();
  await expect(c.open(f.video, defaults("/tmp").camera)).rejects.toThrow("exactly one");
  expect(f.getUserMedia).not.toHaveBeenCalled();
});
it("uses exact saved device constraints and reports unavailable autofocus honestly", async () => {
  const f = fixture(),
    c = new Camera();
  await c.open(f.video, { ...defaults("/tmp").camera, deviceId: "sony" });
  expect(f.getUserMedia).toHaveBeenCalledWith(
    expect.objectContaining({
      video: expect.objectContaining({ deviceId: { exact: "sony" } }),
    }),
  );
  expect(c.info().autofocus).toContain("Not exposed");
  c.stop();
});
it("requires a real-scene confirmation once per Sony connection", async () => {
  const f = fixture(),
    c = new Camera(),
    cfg = defaults("/tmp").camera;
  await c.open(f.video, cfg);
  expect(c.ready).toBe(false);
  await expect(c.capture()).rejects.toThrow("confirm");
  c.confirmScene();
  await c.open(f.video, cfg);
  expect(c.ready).toBe(true);
  expect(f.getUserMedia).toHaveBeenCalledTimes(1);
  c.stop();
  await c.open(f.video, cfg);
  expect(c.ready).toBe(false);
  c.stop();
});
it("changing camera preferences replaces the stream and clears confirmation", async () => {
  const f = fixture(),
    c = new Camera(),
    cfg = defaults("/tmp").camera;
  await c.open(f.video, cfg);
  c.confirmScene();
  await c.open(f.video, { ...cfg, captureWidth: 1280 });
  expect(f.track.stop).toHaveBeenCalledTimes(1);
  expect(f.getUserMedia).toHaveBeenCalledTimes(2);
  expect(c.ready).toBe(false);
  c.stop();
});
