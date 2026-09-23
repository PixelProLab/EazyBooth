import { guestFrames } from "../shared/settings";
import { useEffect, useState, useRef } from "react";
import type { Settings, Health, Printer } from "../shared/types";
import type { Camera } from "./camera";
import { Live } from "./Live";
import { NumericKeypad } from "./NumericKeypad";
import { ProfilesPanel, Branding, FrameLayout } from "./EventEditor";
import { Gallery } from "./Gallery";
export function Admin({
  settings,
  initialTab = "Profiles / Events",
  camera,
  video,
  onSaved,
  onClose,
}: {
  settings: Settings;
  initialTab?: string;
  camera: Camera;
  video: HTMLVideoElement | null;
  onSaved: (s: Settings) => void;
  onClose: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(settings)),
    [tab, setTab] = useState(initialTab),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [printers, setPrinters] = useState<Printer[]>([]),
    [health, setHealth] = useState<Health>(),
    [message, setMessage] = useState(""),
    [testing, setTesting] = useState(camera.active),
    [busy, setBusy] = useState(false),
    [galleryPrinting, setGalleryPrinting] = useState(false),
    [raw, setRaw] = useState(""),
    [info, setInfo] = useState(camera.info()),
    [newPin, setNewPin] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const mounted = useRef(true),
    operationBusy = useRef(false),
    galleryBusy = useRef(false),
    op = useRef(0),
    activity = useRef(Date.now());
  operationBusy.current = busy;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const fail = (e: unknown) => {
    if (mounted.current) setMessage(e instanceof Error ? e.message : String(e));
  };
  const update = (fn: (s: Settings) => void) =>
    setDraft((old) => {
      const next = structuredClone(old);
      fn(next);
      return next;
    });
  async function refresh() {
    try {
      const [d, p, h] = await Promise.all([
        camera.devices(),
        window.booth.printers(),
        window.booth.health(),
      ]);
      if (mounted.current) {
        setDevices(d);
        setPrinters(p);
        setHealth(h);
      }
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    navigator.mediaDevices.addEventListener("devicechange", changed);
    const idle = setInterval(() => {
      if (mounted.current) setInfo(camera.info());
      if (
        !galleryBusy.current &&
        !operationBusy.current &&
        Date.now() - activity.current > 10 * 60 * 1000
      )
        void onClose().catch(fail);
    }, 1000);
    return () => {
      mounted.current = false;
      op.current++;
      clearInterval(idle);
      navigator.mediaDevices.removeEventListener("devicechange", changed);
    };
  }, []);
  useEffect(() => {
    camera.onFault = (text) => {
      setMessage(text);
      setTesting(false);
      camera.stop();
    };
  }, []);
  function stop() {
    op.current++;
    camera.stop();
    setTesting(false);
    setRaw("");
    setInfo(camera.info());
  }
  async function live() {
    if (!video) return;
    setRaw("");
    const token = ++op.current;
    setBusy(true);
    setMessage("");
    try {
      await camera.open(video, draft.camera);
      if (token !== op.current || !mounted.current) return;
      setTesting(true);
      setInfo(camera.info());
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function captureRaw() {
    setBusy(true);
    setMessage("");
    try {
      const id = await window.booth.begin(guestFrames(settings)[0]?.id);
      const bytes = await camera.capture();
      const result = await window.booth.capture(id, bytes, true);
      if (mounted.current) {
        setRaw(result.url);
        setMessage(
          `Original saved locally: ${result.width} × ${result.height}. No native shutter capture.`,
        );
      }
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const s = await window.booth.saveSettings(draft);
      if (JSON.stringify(s.camera) !== JSON.stringify(settings.camera)) stop();
      onSaved(s);
      setDraft(s);
      setMessage("Settings saved");
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const number = (
    label: string,
    value: number,
    change: (n: number) => void,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label>
      {label}
      <input
        name={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => change(e.target.valueAsNumber)}
      />
    </label>
  );
  const check = (label: string, value: boolean, change: (b: boolean) => void) => (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => change(e.target.checked)} />
      {label}
    </label>
  );
  return (
    <section
      className="admin"
      onPointerDown={() => (activity.current = Date.now())}
      onKeyDown={() => (activity.current = Date.now())}
    >
      <header className="admin-header">
        <div>
          <span className="eyebrow">EAZYBOOTH / PIXEL PRO LAB</span>
          <h1>Booth control</h1>
        </div>
        <button
          className="secondary"
          disabled={busy || galleryPrinting || dirty}
          onClick={() => void onClose().catch(fail)}
        >
          Lock & return to Welcome
        </button>
      </header>
      <nav aria-label="Operator sections">
        {[
          "Profiles / Events",
          "Saved photos",
          "Branding",
          "Camera",
          "Layout",
          "Printing",
          "Session & storage",
          "Readiness",
        ].map((t) => (
          <button
            key={t}
            disabled={busy || galleryPrinting}
            aria-current={tab === t ? "page" : undefined}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="admin-body">
        {tab === "Profiles / Events" && (
          <ProfilesPanel
            draft={draft}
            update={update}
            fail={fail}
            disabled={busy || galleryPrinting || dirty}
            onSwitch={(s) => {
              stop();
              setDraft(s);
              onSaved(s);
              setRaw("");
              setMessage("Event opened");
              void refresh();
            }}
          />
        )}
        {tab === "Branding" && <Branding draft={draft} update={update} fail={fail} />}
        {tab === "Layout" && (
          <FrameLayout
            draft={draft}
            update={update}
            fail={fail}
            video={video}
            active={testing}
          />
        )}
        {tab === "Saved photos" && (
          <Gallery
            maxCopies={settings.maxGuestCopies}
            printer={settings.printer}
            onPrinting={(value) => {
              galleryBusy.current = value;
              setGalleryPrinting(value);
              activity.current = Date.now();
            }}
          />
        )}
        {tab === "Camera" && (
          <div className="admin-grid">
            <section className="card">
              <span className="eyebrow">01 / CAMERA</span>
              <h2>Camera source</h2>
              <p>Select its Windows video source. A utility logo is not a live scene.</p>
              <label>
                Camera
                <select
                  value={draft.camera.deviceId}
                  onChange={(e) => {
                    stop();
                    update((s) => (s.camera.deviceId = e.target.value));
                  }}
                >
                  <option value="auto-sony">Automatic — one Sony source only</option>
                  {devices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                  {draft.camera.deviceId !== "auto-sony" &&
                    !devices.some((d) => d.deviceId === draft.camera.deviceId) && (
                      <option value={draft.camera.deviceId}>
                        Saved camera — currently unavailable
                      </option>
                    )}
                </select>
              </label>
              <button className="secondary" onClick={() => void refresh()}>
                Refresh cameras
              </button>
              <div className="fields">
                {number(
                  "Preview width budget",
                  draft.camera.previewWidth,
                  (n) => update((s) => (s.camera.previewWidth = n)),
                  240,
                  4096,
                )}
                {number(
                  "Preview height preference",
                  draft.camera.previewHeight,
                  (n) => update((s) => (s.camera.previewHeight = n)),
                  240,
                  4096,
                )}
                {number(
                  "Capture stream width preference",
                  draft.camera.captureWidth,
                  (n) => update((s) => (s.camera.captureWidth = n)),
                  240,
                  4096,
                )}
                {number(
                  "Capture stream height preference",
                  draft.camera.captureHeight,
                  (n) => update((s) => (s.camera.captureHeight = n)),
                  240,
                  4096,
                )}
              </div>
              <p className="hint">
                One stream serves preview and capture. Capture preferences request the
                stream size; preview is scaled to a bounded display canvas. The driver may
                supply less. Originals retain the delivered frame dimensions.
              </p>
              {check(
                "Request continuous autofocus when exposed",
                draft.camera.autofocus,
                (b) => update((s) => (s.camera.autofocus = b)),
              )}
              <div className="actions">
                <button disabled={busy} onClick={() => void live()}>
                  Test live view
                </button>
                <button
                  className="secondary"
                  disabled={busy || !testing || !camera.ready}
                  onClick={() => void captureRaw()}
                >
                  Raw capture test
                </button>
                <button className="secondary" disabled={busy} onClick={stop}>
                  Stop test
                </button>
              </div>
              <p className="hint">
                Save settings, test live view, then confirm a real scene before opening
                the booth. The camera stays connected between guests.
              </p>
              {testing && camera.needsConfirmation && (
                <button
                  disabled={busy || camera.ready}
                  onClick={() => {
                    try {
                      camera.confirmScene();
                      setInfo(camera.info());
                      setMessage(
                        "Live scene confirmed. Camera will stay ready on Welcome.",
                      );
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  {camera.ready
                    ? "Live scene confirmed"
                    : "Confirm live scene — ready for guests"}
                </button>
              )}
            </section>
            <section className="card">
              <h2>Live diagnostics</h2>
              {testing ? (
                <Live
                  video={video}
                  settings={draft}
                  active={testing}
                  onReady={() => setInfo(camera.info())}
                  onError={setMessage}
                />
              ) : (
                <div className="preview-empty">Live view is stopped</div>
              )}
              {raw && (
                <img
                  width={info.actual.width || 640}
                  height={info.actual.height || 480}
                  className="raw-image"
                  src={raw}
                  alt="Original raw camera test"
                />
              )}
              <dl>
                <dt>Selected source</dt>
                <dd>{info.label}</dd>
                <dt>Actual delivered frame</dt>
                <dd>
                  {info.actual.width || 0} × {info.actual.height || 0} ·{" "}
                  {info.actual.frameRate || 0} fps
                </dd>
                <dt>Autofocus capability</dt>
                <dd>{info.autofocus}</dd>
                <dt>Still method</dt>
                <dd>{info.nativeStill}</dd>
              </dl>
              <dt>Stream status</dt>
              <dd>{camera.active ? "Connected" : "Disconnected"}</dd>
              <dt>Sony scene confirmation</dt>
              <dd>
                {camera.needsConfirmation
                  ? camera.ready
                    ? "Confirmed for this connection"
                    : "Operator confirmation required"
                  : "Not required for this source"}
              </dd>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  stop();
                  void live();
                }}
              >
                Reconnect
              </button>
              <h3>Sony installation</h3>
              <p>
                Install vendor software, restart Windows, then fully exit Imaging Edge
                Desktop Remote before using the booth.
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  onClick={() => window.booth.sony("desktop").catch(fail)}
                >
                  Get Imaging Edge Desktop
                </button>
                <button
                  className="secondary"
                  onClick={() => window.booth.sony("webcam").catch(fail)}
                >
                  Get Imaging Edge Webcam
                </button>
              </div>
            </section>
          </div>
        )}
        {tab === "Printing" && (
          <section className="card narrow">
            <span className="eyebrow">03 / PRINTING</span>
            <h2>A keepsake in hand</h2>
            <p>
              Choose the installed HiTi Windows printer. Validate its driver, 4×6 paper,
              orientation and margins on the event machine.
            </p>
            <label>
              Windows printer
              <select
                aria-label="Windows printer"
                value={draft.printer.name}
                onChange={(e) =>
                  update((s) => {
                    if (s.printer.name !== e.target.value) s.printer.paper = "auto";
                    s.printer.name = e.target.value;
                  })
                }
              >
                <option value="">Select a printer</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                  </option>
                ))}
                {draft.printer.name &&
                  !printers.some((p) => p.name === draft.printer.name) && (
                    <option value={draft.printer.name}>
                      Saved printer — unavailable
                    </option>
                  )}
              </select>
            </label>
            <button className="secondary" onClick={() => void refresh()}>
              Refresh printers
            </button>
            <button
              className="secondary"
              onClick={() => void window.booth.hitiDrivers().catch(fail)}
            >
              Open official HiTi driver downloads
            </button>
            <p className="hint">
              Install the Windows driver matching the model on your printer label, then
              Refresh printers. Downloads open in your browser and need internet; booth
              capture and printing remain offline.
            </p>
            <div className="fields">
              {number(
                "Default copies",
                draft.printer.copies,
                (n) => update((s) => (s.printer.copies = n)),
                1,
                10,
              )}
              <label>
                Orientation
                <select
                  value={draft.printer.orientation}
                  onChange={(e) =>
                    update(
                      (s) =>
                        (s.printer.orientation = e.target.value as
                          | "landscape"
                          | "portrait"),
                    )
                  }
                >
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait (fit with margins)</option>
                </select>
              </label>
            </div>
            {number(
              "Maximum guest copies",
              draft.maxGuestCopies,
              (n) =>
                update((s) => {
                  s.maxGuestCopies = n;
                }),
              1,
              10,
            )}
            <label>
              Print fit
              <select
                value={draft.printer.fit}
                onChange={(e) =>
                  update((s) => {
                    s.printer.fit = e.target.value as Settings["printer"]["fit"];
                  })
                }
              >
                <option value="contain">Contain entire image</option>
                <option value="cover">Fill page / crop</option>
              </select>
            </label>
            <label>
              Paper preset
              <select
                aria-label="Paper preset"
                value={draft.printer.paper || "auto"}
                onChange={(e) =>
                  update((s) => {
                    s.printer.paper = e.target.value as Settings["printer"]["paper"];
                  })
                }
              >
                <option value="auto">
                  Automatic — HiTi / other printers 4 × 6; SELPHY postcard
                </option>
                <option value="selphy-postcard">
                  Canon SELPHY CP1500 — postcard 100 × 148 mm
                </option>
                <option value="4x6">
                  HiTi / standard 4 × 6 inches — 101.6 × 152.4 mm
                </option>
              </select>
            </label>
            <p className="hint">
              For HiTi, select 4 × 6 in Windows printing preferences and load the matching
              paper/ribbon kit. Use landscape and one copy for the first test. Changing
              printers resets the paper preset to Automatic; save settings before printing
              saved photos. Check old failed jobs in the Windows queue before retrying.
            </p>
            {check(
              "Request borderless / no application margins",
              draft.printer.borderless,
              (b) => update((s) => (s.printer.borderless = b)),
            )}
            <p>
              Final image: {draft.canvas.width} × {draft.canvas.height} at 300 DPI. Driver
              margins and paper output require a physical test.
            </p>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await window.booth.saveSettings(draft).then(onSaved);
                  setMessage((await window.booth.testPrint()).message);
                } catch (e) {
                  fail(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save & send test print
            </button>
            <p className="hint">
              Success means Windows accepted the job. It does not prove paper emerged.
              Check the Windows queue before retrying an uncertain job.
            </p>
          </section>
        )}
        {tab === "Session & storage" && (
          <section className="card narrow">
            <span className="eyebrow">04 / SESSION</span>
            <h2>Ready for the next guest</h2>
            <div className="fields">
              {number(
                "Countdown (seconds)",
                draft.countdown,
                (n) => update((s) => (s.countdown = n)),
                1,
                15,
              )}
              {number(
                "Inactivity reset (seconds)",
                draft.inactivity,
                (n) => update((s) => (s.inactivity = n)),
                15,
                900,
              )}
              {number(
                "After Done / accepted print (seconds)",
                draft.postAction,
                (n) => update((s) => (s.postAction = n)),
                0,
                15,
              )}
            </div>
            {check("Fullscreen kiosk mode", draft.fullscreen, (b) =>
              update((s) => (s.fullscreen = b)),
            )}
            <label>
              Local photo storage
              <input value={draft.storage} readOnly />
            </label>
            <p className="hint">
              Each event has an isolated managed photo folder. Back up the full EazyBooth
              data directory. Low disk space blocks captures below 512 MB.
            </p>
            <h3>Operator access</h3>
            <NumericKeypad
              label="New PIN (6–12 digits)"
              secret
              value={newPin}
              onChange={setNewPin}
              confirmLabel="Change PIN"
              onConfirm={() => {
                void window.booth
                  .setPin(newPin)
                  .then(() => {
                    setNewPin("");
                    setMessage("Operator PIN updated");
                  })
                  .catch(fail);
              }}
            />
            <h3>Reset controls</h3>
            <div className="actions">
              <button
                className="secondary"
                onClick={async () => {
                  stop();
                  try {
                    await window.booth.reset();
                    setMessage("Session reset. Saved photographs preserved.");
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                Reset current session
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  stop();
                  try {
                    setDraft(await window.booth.defaults());
                    setMessage(
                      "Defaults loaded for review. Save to apply. Existing photographs and PIN are preserved.",
                    );
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                Load default settings
              </button>
            </div>
          </section>
        )}
        {tab === "Readiness" && (
          <section className="card narrow">
            <span className="eyebrow">05 / READINESS</span>
            <h2>Before the first guest</h2>
            <dl>
              <dt>Camera selected</dt>
              <dd>{settings.camera.deviceId || "Not selected"}</dd>
              <dt>Camera connected</dt>
              <dd>{camera.active ? "Connected" : "Not connected"}</dd>
              <dt>Sony confirmation</dt>
              <dd>
                {camera.needsConfirmation && !camera.ready
                  ? "Required"
                  : "Ready or not required"}
              </dd>
              <dt>Printer selected / available</dt>
              <dd>
                {settings.printer.name
                  ? `${settings.printer.name} / ${printers.some((p) => p.name === settings.printer.name) ? "Available" : "Unavailable"}`
                  : "Not selected"}
              </dd>
              {health?.assets &&
                Object.entries(health.assets).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k} artwork</dt>
                    <dd>{v ? "Valid or optional" : "Invalid — replace artwork"}</dd>
                  </div>
                ))}
            </dl>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => {
                  setTab("Camera");
                  void live();
                }}
              >
                Test camera
              </button>
              <button
                disabled={busy || !camera.ready}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const id = await window.booth.begin(guestFrames(settings)[0]?.id);
                    const result = await window.booth.capture(id, await camera.capture());
                    setRaw(result.url);
                    setMessage("Test photo saved using the saved event configuration.");
                  } catch (e) {
                    fail(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Capture test photo
              </button>
              <button
                className="secondary"
                onClick={() => window.booth.openStorage().catch(fail)}
              >
                Open photo folder
              </button>
              <button className="secondary" onClick={() => setTab("Printing")}>
                Test printer
              </button>
            </div>
            {raw && (
              <img
                className="raw-image"
                width={draft.canvas.width}
                height={draft.canvas.height}
                src={raw}
                alt="Final test composition"
              />
            )}
            <button className="secondary" onClick={() => void refresh()}>
              Refresh health
            </button>
            {health && (
              <>
                <div className="stats">
                  {Object.entries(health.stats).map(([k, v]) => (
                    <div key={k}>
                      <strong>{v}</strong>
                      <span>{k.replace(/([A-Z])/g, " $1")}</span>
                    </div>
                  ))}
                </div>
                <dl>
                  <dt>Profile</dt>
                  <dd>{health.profile}</dd>
                  <dt>Photo storage</dt>
                  <dd>{health.storage}</dd>
                  <dt>Available disk</dt>
                  <dd>
                    {(health.freeBytes / 1024 ** 3).toFixed(1)} GB ·{" "}
                    {health.writable ? "Writable" : "Unavailable"}
                    {health.freeBytes < 2 * 1024 ** 3
                      ? " — free space before the event"
                      : ""}
                  </dd>
                  <dt>System memory</dt>
                  <dd>{health.ramGB.toFixed(1)} GB</dd>
                  <dt>Settings</dt>
                  <dd>{health.settingsError || "Readable / local"}</dd>
                  <dt>Selected camera</dt>
                  <dd>
                    {devices.some((d) => d.deviceId === draft.camera.deviceId)
                      ? "Listed by Windows — live test required"
                      : draft.camera.deviceId === "auto-sony"
                        ? "Automatic Sony selection — live test required"
                        : "Unavailable"}
                  </dd>
                  <dt>Selected printer</dt>
                  <dd>
                    {printers.some((p) => p.name === draft.printer.name)
                      ? "Installed — physical print required"
                      : "Not selected or unavailable"}
                  </dd>
                  <dt>Acceptance</dt>
                  <dd>
                    Physical camera scene, focus, print output and sustained kiosk
                    operation must be checked onsite.
                  </dd>
                </dl>
              </>
            )}
          </section>
        )}
      </div>
      <footer className="admin-footer">
        {dirty && (
          <button
            className="secondary"
            disabled={busy || galleryPrinting}
            onClick={() => {
              setDraft(structuredClone(settings));
              setMessage("Unsaved changes discarded");
            }}
          >
            Discard changes
          </button>
        )}
        <button
          className="secondary"
          disabled={busy || galleryPrinting || dirty}
          onClick={() => void onClose().catch(fail)}
        >
          Launch Booth
        </button>
        <p role="status">
          {message ||
            (dirty
              ? "Unsaved changes — save or discard before launch."
              : "All changes saved locally.")}
        </p>
        <button disabled={busy || galleryPrinting} onClick={() => void save()}>
          Save settings
        </button>
      </footer>
    </section>
  );
}
