import type { Settings } from "../shared/types";
export class Camera {
  private stream: MediaStream | null = null;
  private opening: Promise<void> | null = null;
  private generation = 0;
  private video: HTMLVideoElement | null = null;
  private cleanup?: () => void;
  private capturing: Promise<ArrayBuffer> | null = null;
  private configKey = "";
  private confirmed = false;
  get active() {
    const t = this.stream?.getVideoTracks()[0];
    return !!this.stream?.active && t?.readyState === "live" && !t.muted;
  }
  get needsConfirmation() {
    return /sony|imaging edge/i.test(this.stream?.getVideoTracks()[0]?.label || "");
  }
  get ready() {
    return this.active && (!this.needsConfirmation || this.confirmed);
  }
  confirmScene() {
    if (!this.active || !this.video?.videoWidth || this.video.readyState < 2)
      throw Error("Wait for a live camera scene before confirming");
    this.confirmed = true;
  }
  onFault: (message: string) => void = () => {};
  async devices() {
    return (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput",
    );
  }
  private async request(constraints: MediaStreamConstraints, generation: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // getUserMedia cannot be cancelled; dispose late streams after deadline/reset.
    const pending = navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        throw Error("Camera opening cancelled");
      }
      return stream;
    });
    try {
      return await Promise.race([
        pending,
        new Promise<MediaStream>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                Error(
                  "Camera did not respond within 12 seconds. Check its connection and retry.",
                ),
              ),
            12000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
  open(video: HTMLVideoElement, config: Settings["camera"]): Promise<void> {
    const key = JSON.stringify(config);
    if (this.configKey && this.configKey !== key) this.stop();
    this.configKey = key;
    if (this.opening) return this.opening;
    if (this.active) {
      video.srcObject = this.stream;
      this.video = video;
      return video.play();
    }
    const generation = this.generation;
    this.video = video;
    const start = async () => {
      let id = config.deviceId;
      if (id === "auto-sony") {
        let devices = await this.devices();
        if (devices.length && devices.every((d) => !d.label)) {
          const permission = await this.request(
            {
              video: true,
              audio: false,
            },
            generation,
          );
          permission.getTracks().forEach((t) => t.stop());
          if (generation !== this.generation) throw Error("Camera opening cancelled");
          devices = await this.devices();
        }
        const matches = devices.filter((d) => /sony|imaging edge/i.test(d.label));
        if (matches.length !== 1)
          throw Error(
            "Select the Sony camera in operator settings. Automatic selection needs exactly one Sony video source.",
          );
        id = matches[0].deviceId;
      }
      if (!id) throw Error("Select a camera in operator settings");
      const stream = await this.request(
        {
          audio: false,
          video: {
            deviceId: { exact: id },
            width: { ideal: config.captureWidth },
            height: { ideal: config.captureHeight },
            frameRate: { ideal: 30, max: 30 },
          },
        },
        generation,
      );
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error("Camera opening cancelled");
      }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw Error("Camera delivered no video track");
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & {
        focusMode?: string[];
      };
      if (config.autofocus && caps?.focusMode?.includes("continuous")) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
          });
        } catch {
          /* Report capabilities without promising autofocus was applied. */
        }
      }
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error("Camera opening cancelled");
      }
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          video.play(),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(Error("Camera did not start within 12 seconds")),
              12000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      if (generation !== this.generation) throw Error("Camera opening cancelled");
      let lastTime = video.currentTime,
        lastFrame = performance.now(),
        failed = false;
      const fail = () => {
        if (failed || generation !== this.generation) return;
        failed = true;
        this.confirmed = false;
        this.onFault(
          "Camera disconnected or stopped delivering frames. Check power and USB, then reconnect.",
        );
      };
      track.addEventListener("ended", fail);
      track.addEventListener("mute", fail);
      const timer = setInterval(() => {
        if (video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          lastFrame = performance.now();
        }
        if (
          track.readyState === "ended" ||
          track.muted ||
          performance.now() - lastFrame > 10000
        )
          fail();
      }, 500);
      this.cleanup = () => {
        clearInterval(timer);
        track.removeEventListener("ended", fail);
        track.removeEventListener("mute", fail);
      };
    };
    const opening = start()
      .catch((e) => {
        if (generation === this.generation) this.stop();
        throw e;
      })
      .finally(() => {
        if (this.opening === opening) this.opening = null;
      });
    this.opening = opening;
    return this.opening;
  }
  info() {
    const track = this.stream?.getVideoTracks()[0],
      caps = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & { focusMode?: string[] })
        | undefined;
    return {
      label: track?.label || "No active camera",
      actual: track?.getSettings() || {},
      autofocus: caps?.focusMode?.includes("continuous")
        ? "Continuous focus reported"
        : "Not exposed by this Windows video driver",
      nativeStill: "Video-frame capture; native Sony shutter SDK is not installed",
    };
  }
  capture() {
    if (!this.ready)
      return Promise.reject(Error("Operator must confirm the live camera scene first"));
    if (this.capturing) return this.capturing;
    const generation = this.generation;
    const task = async () => {
      const v = this.video,
        t = this.stream?.getVideoTracks()[0];
      if (
        !v ||
        !v.videoWidth ||
        !v.videoHeight ||
        t?.readyState !== "live" ||
        t.muted ||
        !this.stream?.active
      )
        throw Error("Camera has no healthy live frame");
      if (v.videoWidth * v.videoHeight > 24000000)
        throw Error("Camera frame exceeds the 24-megapixel memory budget");
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      try {
        canvas.getContext("2d")!.drawImage(v, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(Error("Cannot encode camera frame"))),
            "image/png",
          ),
        );
        if (generation !== this.generation || t.readyState !== "live" || t.muted)
          throw Error("Camera changed during capture");
        return await blob.arrayBuffer();
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
    this.capturing = task().finally(() => {
      this.capturing = null;
    });
    return this.capturing;
  }
  stop() {
    this.generation++;
    this.confirmed = false;
    this.configKey = "";
    this.opening = null;
    this.cleanup?.();
    this.cleanup = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }
}
