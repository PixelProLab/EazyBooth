import { useEffect, useRef, useState, useMemo } from "react";
import type { Capture, Settings, PrintResult } from "../shared/types";
import { Generation, type Phase } from "../shared/workflow";
import { Camera } from "./camera";
import { Live } from "./Live";
import { NumericKeypad, Modal } from "./NumericKeypad";
import { Welcome } from "./EventEditor";
import { Admin } from "./Admin";
import { selectFrame, guestFrames } from "../shared/settings";
export function App() {
  const [selectedFrame, setSelectedFrame] = useState<string>();
  const [quantityOpen, setQuantityOpen] = useState(false),
    [quantity, setQuantity] = useState("1"),
    [adminTab, setAdminTab] = useState("Profiles / Events");
  const lastCopies = useRef(1);
  const [opening, setOpening] = useState(false);
  const [settings, setSettings] = useState<Settings>(),
    [phase, setPhase] = useState<Phase>("welcome"),
    [video, setVideo] = useState<HTMLVideoElement | null>(null),
    [ready, setReady] = useState(false),
    [cameraActive, setCameraActive] = useState(false),
    [count, setCount] = useState(0),
    [capture, setCapture] = useState<Capture>(),
    [message, setMessage] = useState(""),
    [printResult, setPrintResult] = useState<PrintResult>(),
    [admin, setAdmin] = useState(false),
    [pinOpen, setPinOpen] = useState(false),
    [pin, setPin] = useState(""),
    [pinSet, setPinSet] = useState(true),
    [pinBusy, setPinBusy] = useState(false);
  const camera = useRef(new Camera()).current,
    generation = useRef(new Generation()).current,
    busy = useRef(false),
    phaseRef = useRef(phase),
    timer = useRef<ReturnType<typeof setTimeout>>(),
    lastActivity = useRef(Date.now()),
    tapCount = useRef({ count: 0, time: 0 });
  phaseRef.current = phase;
  const presentation = useMemo(
    () =>
      settings &&
      selectedFrame &&
      guestFrames(settings).some((f) => f.id === selectedFrame)
        ? selectFrame(settings, selectedFrame)
        : settings,
    [settings, selectedFrame],
  );
  const error = (e: unknown) => (e instanceof Error ? e.message : String(e));
  useEffect(() => {
    Promise.all([window.booth.settings(), window.booth.health()])
      .then(([s, h]) => {
        setSettings(s);
        setPinSet(h.pinSet);
        if (!h.pinSet) setPinOpen(true);
        if (h.settingsError) setMessage(h.settingsError);
      })
      .catch((e) => setMessage(error(e)));
    return () => {
      generation.next();
      camera.stop();
      clearTimeout(timer.current);
    };
  }, []);
  async function reset() {
    if (phaseRef.current === "printing") return;
    generation.next();
    clearTimeout(timer.current);
    lastActivity.current = Date.now();
    // Reset the guest transaction, not the event's camera connection.
    setCameraActive(camera.ready);
    setReady(false);
    setOpening(false);
    setCapture(undefined);
    setCount(0);
    setQuantityOpen(false);
    setSelectedFrame(undefined);
    setMessage("");
    setPrintResult(undefined);
    busy.current = false;
    setPhase("welcome");
    try {
      await window.booth.reset();
    } catch (e) {
      setMessage(error(e));
    }
  }
  function armIdle() {
    lastActivity.current = Date.now();
  }
  useEffect(() => {
    armIdle();
  }, [phase, settings, admin]);
  useEffect(() => {
    if (!settings || admin) return;
    // Own this interval in its closure: a previous phase's cleanup must never
    // cancel a newer guest's timeout. Elapsed time also handles Windows sleep.
    const watchdog = setInterval(() => {
      if (
        phaseRef.current !== "welcome" &&
        phaseRef.current !== "printing" &&
        Date.now() - lastActivity.current >= settings.inactivity * 1000
      ) {
        void reset();
      }
    }, 500);
    return () => clearInterval(watchdog);
  }, [settings, admin]);
  const fault = (text: string) => {
    setReady(false);
    setCameraActive(false);
    camera.stop();
    if (!["preview", "countdown"].includes(phaseRef.current)) return;
    generation.next();
    clearTimeout(timer.current);
    busy.current = false;
    setMessage(text);
    setPhase("camera-error");
  };
  if (!admin) camera.onFault = fault;
  useEffect(() => {
    if (!settings || !video || admin || pinOpen || !pinSet) return;
    let cancelled = false;
    // Warm behind Welcome. The same owner is reused by operator diagnostics
    // and every guest; Sony frames stay concealed until visually confirmed.
    camera
      .open(video, settings.camera)
      .then(() => {
        if (!cancelled) setCameraActive(camera.ready);
      })
      .catch((e) => {
        if (!cancelled) {
          setCameraActive(false);
          setMessage(error(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settings, video, admin, pinOpen, pinSet]);
  async function startCamera() {
    if (!settings || !video || busy.current) return;
    const gen = generation.next();
    busy.current = true;
    setOpening(true);
    setMessage("");
    setReady(false);
    setPhase("preview");
    setCameraActive(false);
    try {
      await camera.open(video, settings.camera);
      if (!generation.is(gen)) return;
      setCameraActive(camera.ready);
    } catch (e) {
      if (generation.is(gen)) {
        setMessage(error(e));
        setPhase("camera-error");
        setCameraActive(false);
      }
    } finally {
      if (generation.is(gen)) {
        busy.current = false;
        setOpening(false);
      }
    }
  }
  async function shoot() {
    if (!ready || !camera.ready || busy.current || phaseRef.current !== "preview") return;
    busy.current = true;
    const gen = generation.current();
    try {
      const id = await window.booth.begin(selectedFrame);
      if (!generation.is(gen)) return;
      setPhase("countdown");
      let n = settings!.countdown;
      setCount(n);
      const tick = () => {
        if (!generation.is(gen)) return;
        if (--n > 0) {
          setCount(n);
          timer.current = setTimeout(tick, 1000);
          return;
        }
        setCount(0);
        setPhase("saving");
        camera
          .capture()
          .then((bytes) => window.booth.capture(id, bytes))
          .then((result) => {
            if (!generation.is(gen)) return;
            setCapture(result);
            setPhase("review");
            busy.current = false;
          })
          .catch((e) => {
            if (!generation.is(gen)) return;
            setMessage(error(e));
            setPhase("camera-error");
            busy.current = false;
          });
      };
      timer.current = setTimeout(tick, 1000);
    } catch (e) {
      if (generation.is(gen)) {
        setMessage(error(e));
        busy.current = false;
      }
    }
  }
  function completed(text: string) {
    setMessage(text);
    setPhase("complete");
    timer.current = setTimeout(() => void reset(), settings!.postAction * 1000);
  }
  async function done() {
    if (!capture || busy.current) return;
    busy.current = true;
    const gen = generation.current();
    try {
      await window.booth.approve(capture.id);
      if (generation.is(gen)) completed("Your photo is saved. Thank you!");
    } catch (e) {
      if (generation.is(gen)) {
        setMessage(error(e));
        busy.current = false;
      }
    }
  }
  async function print(copies = 1) {
    if (!capture || busy.current) return;
    busy.current = true;
    lastCopies.current = copies;
    setQuantityOpen(false);
    setMessage("");
    setPhase("printing");
    try {
      const result = await window.booth.print(capture.id, copies, crypto.randomUUID());
      setPrintResult(result);
      busy.current = false;
      if (result.status === "accepted") {
        setMessage("Windows accepted the print job");
        setPhase("review");
      } else {
        setMessage(result.message);
        setPhase("print-error");
      }
    } catch (e) {
      busy.current = false;
      setMessage(error(e));
      setPhase("print-error");
    }
  }
  function retake() {
    if (busy.current) return;
    setCapture(undefined);
    setMessage("");
    setPrintResult(undefined);
    const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (track?.readyState === "live" && !track.muted && camera.ready) {
      setPhase("preview");
    } else {
      camera.stop();
      void startCamera();
    }
  }
  function operator(tab = "Saved photos") {
    setAdminTab(tab);
    if (admin) return;
    if (phaseRef.current === "printing" || phaseRef.current === "saving") return;
    void reset();
    setPin("");
    setMessage("");
    setPinOpen(true);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && ["a", "g"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        operator(e.key.toLowerCase() === "g" ? "Saved photos" : "Profiles / Events");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [settings, admin]);
  async function unlock() {
    if (pinBusy) return;
    setPinBusy(true);
    try {
      await window.booth.unlock(pin);
      setPin("");
      setPinSet(true);
      setPinOpen(false);
      setAdmin(true);
      setMessage("");
    } catch (e) {
      setMessage(error(e));
    } finally {
      setPinBusy(false);
    }
  }
  if (!settings)
    return (
      <main className="center">
        <h1>EazyBooth</h1>
        <p>{message || "Opening…"}</p>
      </main>
    );
  return (
    <main onPointerDown={armIdle} onKeyDown={armIdle}>
      <video
        ref={setVideo}
        className="source-video"
        muted
        playsInline
        aria-hidden="true"
      />
      {phase === "welcome" && !admin && (
        <button
          className="welcome"
          aria-label="Touch anywhere to start"
          onClick={() => {
            if (!pinSet) {
              setPinOpen(true);
              return;
            }
            if (guestFrames(settings).length) {
              setSelectedFrame(undefined);
              setPhase("frame-selection");
            } else void startCamera();
          }}
        >
          <Welcome settings={settings} />
        </button>
      )}
      {!admin && (
        <button
          className="operator-corner"
          aria-label="Operator access"
          onClick={(e) => {
            e.stopPropagation();
            const now = Date.now();
            const taps = tapCount.current;
            taps.count = now - taps.time < 2000 ? taps.count + 1 : 1;
            taps.time = now;
            if (taps.count >= 5) {
              taps.count = 0;
              operator();
            }
          }}
        />
      )}
      {phase !== "welcome" && !admin && (
        <section className="session">
          <header>
            <button
              className="back"
              disabled={phase === "printing" || phase === "saving"}
              onClick={() => void reset()}
              aria-label="Back to welcome"
            >
              ←
            </button>
            <span>
              EAZYBOOTH <i /> {settings.eventName}
            </span>
            <span className="private-note">Pixel Pro Lab</span>
          </header>
          <div className="stage">
            {phase === "frame-selection" && (
              <section className="frame-selection">
                <span className="eyebrow">MAKE IT YOURS</span>
                <h1>Choose your frame</h1>
                <p>Select a design to see yourself live.</p>
                <div className="frame-choices">
                  {guestFrames(settings).map((frame) => (
                    <button
                      className="frame-choice secondary"
                      key={frame.id}
                      onClick={() => {
                        setSelectedFrame(frame.id);
                        void startCamera();
                      }}
                    >
                      <img
                        width={settings.canvas.width}
                        height={settings.canvas.height}
                        src={window.booth.media(frame.asset)}
                        alt={frame.label}
                      />
                      <span>
                        {frame.label} <span aria-hidden="true">→</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div
              className={
                ["preview", "countdown"].includes(phase) && cameraActive
                  ? "live-panel"
                  : "live-panel hidden"
              }
            >
              <Live
                video={video}
                settings={presentation || settings}
                active={cameraActive && ["preview", "countdown"].includes(phase)}
                onReady={() => setReady(true)}
                onError={fault}
              />
            </div>
            {capture && ["review", "printing", "print-error"].includes(phase) && (
              <img
                className="photo"
                src={capture.url}
                width={settings.canvas.width}
                height={settings.canvas.height}
                alt="Your final photograph"
              />
            )}
            {phase === "countdown" && (
              <div className="countdown" role="status" aria-live="assertive">
                {count}
              </div>
            )}
            {phase === "preview" && !ready && (
              <div className="camera-wait center" role="status">
                <div className="spinner" />
                <h2>{settings.preparingText}</h2>
                <p>
                  {!opening && camera.needsConfirmation
                    ? "Please ask the operator to confirm the live view."
                    : "Your photo session will be ready shortly."}
                </p>
              </div>
            )}
            {phase === "saving" && (
              <div className="center">
                <div className="spinner" />
                <h2>Preparing your photo…</h2>
              </div>
            )}
            {phase === "camera-error" && (
              <div className="center">
                <h2>Let’s reconnect the camera</h2>
                <p role="alert">{message}</p>
                <button
                  onClick={() => {
                    camera.stop();
                    void startCamera();
                  }}
                >
                  Reconnect camera
                </button>
                <button className="secondary" onClick={() => void reset()}>
                  Return to Welcome
                </button>
              </div>
            )}
            {phase === "complete" && (
              <div className="center">
                <span className="success-mark">✓</span>
                <h2>{message}</h2>
              </div>
            )}
          </div>
          <footer>
            {phase === "preview" && (
              <>
                <p>Find your place in the frame.</p>
                <button
                  className="primary start"
                  disabled={!ready || opening}
                  onClick={() => void shoot()}
                >
                  Start
                </button>
                {message && <p role="alert">{message}</p>}
              </>
            )}
            {phase === "countdown" && <p>Look at the camera</p>}
            {phase === "review" && (
              <>
                <p>Photo saved locally. Take your moment with you.</p>
                <div className="actions">
                  <button className="secondary" onClick={retake}>
                    Retake
                  </button>
                  <button className="secondary" onClick={() => void done()}>
                    Done
                  </button>
                  <button className="primary" onClick={() => void print()}>
                    {printResult?.status === "accepted"
                      ? "Print another copy"
                      : printResult?.status === "unknown"
                        ? "I checked the queue — Print 1"
                        : "Print 1"}
                  </button>
                  <button
                    className="secondary"
                    disabled={printResult?.status === "unknown"}
                    onClick={() => {
                      setQuantity(
                        String(
                          Math.min(settings.printer.copies, settings.maxGuestCopies),
                        ),
                      );
                      setQuantityOpen(true);
                    }}
                  >
                    More Prints
                  </button>
                </div>
                {message && <p role="status">{message}</p>}
              </>
            )}
            {phase === "printing" && (
              <p role="status">Waiting for Windows to accept the print job…</p>
            )}
            {phase === "print-error" && (
              <>
                <p role="alert">{message}</p>
                <div className="actions">
                  <button onClick={() => void print(lastCopies.current)}>
                    {printResult?.status === "unknown"
                      ? "I checked the queue — Retry"
                      : "Retry"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setMessage("");
                      setPhase("review");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </footer>
        </section>
      )}
      {pinOpen && (
        <Modal
          title="Operator access"
          onClose={pinSet ? () => setPinOpen(false) : undefined}
        >
          <span className="eyebrow">EAZYBOOTH · OPERATOR</span>
          <h1>{pinSet ? "Welcome back" : "Set your operator PIN"}</h1>
          <p>
            {pinSet
              ? "Enter your local operator PIN."
              : "Choose 6–12 digits. Keep this PIN with the event operator."}
          </p>
          <NumericKeypad
            label="Operator PIN"
            secret
            value={pin}
            onChange={setPin}
            disabled={pinBusy}
            onConfirm={() => void unlock()}
            confirmLabel={pinSet ? "Unlock" : "Set PIN & continue"}
          />
          {message && <p role="alert">{message}</p>}
          {pinSet && (
            <button className="secondary" onClick={() => setPinOpen(false)}>
              Cancel
            </button>
          )}
        </Modal>
      )}
      {quantityOpen && (
        <Modal title="More Prints" onClose={() => setQuantityOpen(false)}>
          <h2>More Prints</h2>
          <p>Choose 1–{settings.maxGuestCopies} copies for this photo.</p>
          <NumericKeypad
            label="Print quantity"
            value={quantity}
            onChange={setQuantity}
            maxLength={2}
            onConfirm={() => {
              const n = Number(quantity);
              if (!Number.isInteger(n) || n < 1 || n > settings.maxGuestCopies) {
                setMessage(`Choose 1–${settings.maxGuestCopies} copies`);
                return;
              }
              void print(n);
            }}
          />
          <p role="alert">{message}</p>
          <button className="secondary" onClick={() => setQuantityOpen(false)}>
            Cancel
          </button>
        </Modal>
      )}
      {admin && (
        <Admin
          settings={settings}
          initialTab={adminTab}
          camera={camera}
          video={video}
          onSaved={setSettings}
          onClose={async () => {
            await window.booth.lock();
            setAdmin(false);
            await reset();
          }}
        />
      )}
      {phase === "welcome" && !pinOpen && message && (
        <div className="welcome-notice" role="alert">
          {message}
        </div>
      )}
    </main>
  );
}
