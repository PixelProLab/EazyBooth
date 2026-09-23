// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { App } from "../src/renderer/App";
import { defaults, setPhotoLayout } from "../src/shared/settings";
import type { API, Settings } from "../src/shared/types";
const fake = vi.hoisted(() => ({
  opens: 0,
  stops: 0,
  liveStarts: 0,
  fail: false,
  sony: false,
}));
vi.mock("../src/renderer/camera", () => ({
  Camera: class {
    onFault = () => {};
    active = false;
    get ready() {
      return this.active && !fake.sony;
    }
    get needsConfirmation() {
      return fake.sony;
    }
    async open(v: HTMLVideoElement) {
      if (this.active) return;
      fake.opens++;
      if (fake.fail) throw Error("Device disconnected");
      this.active = true;
      v.srcObject = {
        getVideoTracks: () => [{ readyState: "live", muted: false }],
      } as unknown as MediaStream;
    }
    stop() {
      fake.stops++;
      this.active = false;
    }
    async capture() {
      return new ArrayBuffer(400);
    }
    info() {
      return {};
    }
  },
}));
vi.mock("../src/renderer/Admin", () => ({ Admin: () => null }));
vi.mock("../src/renderer/Live", () => ({
  Live: ({
    active,
    settings,
    onReady,
  }: {
    active: boolean;
    settings: Settings;
    onReady: () => void;
  }) => {
    useEffect(() => {
      if (active) {
        fake.liveStarts++;
        onReady();
      }
    }, [active, settings]);
    return <canvas aria-label="Live framed camera preview" />;
  },
}));
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
async function begin() {
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Touch anywhere to start" }));
  await settle();
}
async function take() {
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await settle();
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  await settle();
}
beforeEach(() => {
  vi.useFakeTimers();
  fake.opens = 0;
  fake.liveStarts = 0;
  fake.stops = 0;
  fake.fail = false;
  fake.sony = false;
  const s = defaults("C:/private");
  s.countdown = 1;
  s.inactivity = 15;
  s.postAction = 1;
  window.booth = {
    settings: vi.fn(async () => s),
    health: vi.fn(async () => ({ pinSet: true, settingsError: "" })),
    media: (p: string) => p,
    begin: vi.fn(async () => crypto.randomUUID()),
    capture: vi.fn(async (id: string) => ({
      id,
      url: "data:image/png;base64,x",
      width: 640,
      height: 480,
    })),
    reset: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    print: vi.fn(async () => ({ status: "accepted", message: "Accepted" })),
  } as unknown as API;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("resets consecutive abandoned sessions and extends idle time only on activity", async () => {
  render(<App />);
  for (let cycle = 0; cycle < 3; cycle++) {
    await begin();
    await act(async () => vi.advanceTimersByTime(10000));
    fireEvent.pointerDown(screen.getByRole("main"));
    await act(async () => vi.advanceTimersByTime(10000));
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(5500));
    expect(screen.getByRole("button", { name: "Touch anywhere to start" })).toBeTruthy();
  }
});
it("runs countdown, retake on the same stream, Done approval and post-action reset", async () => {
  render(<App />);
  await begin();
  await take();
  expect(screen.getByRole("button", { name: "Retake" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retake" }));
  await take();
  expect(fake.opens).toBe(1);
  expect(window.booth.capture).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await settle();
  expect(window.booth.approve).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("button", { name: "Touch anywhere to start" })).toBeTruthy();
  await begin();
  await take();
  expect(fake.opens).toBe(1);
  expect(fake.stops).toBe(0);
});
it("conceals unconfirmed Sony frames and prevents captures", async () => {
  fake.sony = true;
  render(<App />);
  await begin();
  expect(screen.getByText("Getting the camera ready…")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(window.booth.begin).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText("Live framed camera preview").parentElement?.className,
  ).toContain("hidden");
});
it("abandoned countdown resets without a late capture", async () => {
  render(<App />);
  await begin();
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Back to welcome" }));
  await settle();
  await act(async () => vi.advanceTimersByTime(2000));
  expect(window.booth.capture).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Touch anywhere to start" })).toBeTruthy();
});
it("ignores a late saved result after inactivity clears a saving session", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(window.booth.capture).mockImplementation(
    () => new Promise((r) => (resolve = r)) as any,
  );
  render(<App />);
  await begin();
  await take();
  expect(screen.getByText("Preparing your photo…")).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(16000));
  expect(screen.getByRole("button", { name: "Touch anywhere to start" })).toBeTruthy();
  await act(async () => resolve({ id: "late", url: "data:image/png;base64,x" }));
  expect(screen.queryByRole("button", { name: "Retake" })).toBeNull();
});
it("holds review while Windows is pending, then permits Retry and Cancel on failure", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(window.booth.print).mockImplementationOnce(
    () => new Promise((r) => (resolve = r)) as any,
  );
  render(<App />);
  await begin();
  await take();
  fireEvent.click(screen.getByRole("button", { name: "Print 1" }));
  await settle();
  await act(async () => vi.advanceTimersByTime(16000));
  expect(screen.getByText("Waiting for Windows to accept the print job…")).toBeTruthy();
  await act(async () => resolve({ status: "failed", message: "Out of paper" }));
  expect(screen.getByText("Out of paper")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await settle();
  expect(screen.getByRole("button", { name: "Print another copy" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await settle();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("button", { name: "Touch anywhere to start" })).toBeTruthy();
  expect(window.booth.capture).toHaveBeenCalledTimes(1);
});
it("recovers camera-open failure via reconnect", async () => {
  fake.fail = true;
  render(<App />);
  await begin();
  expect(screen.getByText("Device disconnected")).toBeTruthy();
  fake.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Reconnect camera" }));
  await settle();
  await take();
  expect(screen.getByRole("button", { name: "Retake" })).toBeTruthy();
});

it("selected frame stays stable across countdown ticks and is sent to the capture transaction", async () => {
  const s = defaults("C:/private");
  s.countdown = 3;
  s.frames = [1, 2].map((n) => ({
    id: `frame-${n}`,
    label: `Frame ${n}`,
    asset: `frame-${n}.png`,
    geometry: structuredClone(s.geometry),
  }));
  vi.mocked(window.booth.settings).mockResolvedValue(s);
  render(<App />);
  await begin();
  expect(screen.getByRole("heading", { name: "Choose your frame" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Frame 2/ }));
  await settle();
  expect(fake.liveStarts).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await settle();
  for (let n = 0; n < 2; n++) {
    await act(async () => vi.advanceTimersByTime(1000));
    expect(fake.liveStarts).toBe(1);
  }
  await act(async () => vi.advanceTimersByTime(1000));
  await settle();
  expect(window.booth.begin).toHaveBeenCalledWith("frame-2");
  expect(fake.opens).toBe(1);
});

it.each(["camera", "background"] as const)(
  "%s mode goes straight to camera even with two retained frames",
  async (mode) => {
    const s = defaults("C:/private");
    s.countdown = 1;
    s.background = "background.png";
    s.frames = [1, 2].map((n) => ({
      id: `frame-${n}`,
      label: `Frame ${n}`,
      asset: `${n}.png`,
      geometry: structuredClone(s.geometry),
    }));
    setPhotoLayout(s, mode);
    vi.mocked(window.booth.settings).mockResolvedValue(s);
    render(<App />);
    await begin();
    expect(screen.queryByRole("heading", { name: "Choose your frame" })).toBeNull();
    await take();
    expect(window.booth.begin).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole("button", { name: "Print 1" })).toBeTruthy();
  },
);
