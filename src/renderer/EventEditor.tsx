import { useEffect, useRef, useState, useMemo } from "react";
import type { Settings } from "../shared/types";
import { Live } from "./Live";
import { Modal } from "./NumericKeypad";
import { selectFrame } from "../shared/settings";
type EditProps = {
  draft: Settings;
  update: (fn: (s: Settings) => void) => void;
  fail: (e: unknown) => void;
};
export function ProfilesPanel({
  draft,
  update,
  fail,
  onSwitch,
  disabled,
}: EditProps & { onSwitch: (s: Settings) => void; disabled: boolean }) {
  const [profiles, setProfiles] = useState<
    { id: string; name: string; error?: string }[]
  >([]);
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    window.booth.profiles().then(setProfiles).catch(fail);
  }, [draft.profileId]);
  async function run(work: () => Promise<Settings>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      onSwitch(await work());
      setName("");
    } catch (e) {
      fail(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="admin-grid">
      <section className="card">
        <span className="eyebrow">YOUR EVENT WORKSPACE</span>
        <h2>One booth. Every occasion.</h2>
        <p>
          Create an event, bring in your artwork, then launch. Each event keeps its own
          photos and settings.
        </p>
        <label>
          Active event name
          <input
            name="event-name"
            autoComplete="off"
            maxLength={100}
            value={draft.eventName}
            onChange={(e) =>
              update((s) => {
                s.eventName = e.target.value;
              })
            }
          />
        </label>
        <label>
          New event name
          <input
            name="new-event-name"
            autoComplete="off"
            maxLength={100}
            placeholder="e.g. Autumn gathering…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="actions">
          <button
            disabled={busy || disabled || !name.trim()}
            onClick={() => void run(() => window.booth.createProfile(name))}
          >
            Create Event
          </button>
          <button
            className="secondary"
            disabled={busy || disabled || !name.trim()}
            onClick={() =>
              void run(() => window.booth.createProfile(name, draft.profileId))
            }
          >
            Duplicate Profile
          </button>
        </div>
        <p className="hint">
          Duplication uses saved settings and copies artwork. Photos and print receipts
          stay with the original event. Save changes before creating or switching events.
        </p>
      </section>
      <section className="card">
        <h2>Your events</h2>
        <div className="event-list">
          {profiles.map((p) => (
            <button
              className={
                p.id === draft.profileId ? "event-row selected" : "event-row secondary"
              }
              key={p.id}
              disabled={busy || disabled || p.id === draft.profileId}
              onClick={() => void run(() => window.booth.switchProfile(p.id))}
            >
              <span>{p.name}</span>
              <small>
                {p.id === draft.profileId
                  ? "ACTIVE EVENT"
                  : p.error
                    ? "Needs recovery"
                    : "Open event →"}
              </small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
export function Welcome({
  settings,
  preview = false,
}: {
  settings: Settings;
  preview?: boolean;
}) {
  return settings.welcome ? (
    <img
      width={1920}
      height={1080}
      style={{ objectFit: settings.welcomeFit }}
      src={window.booth.media(settings.welcome)}
      alt={`${settings.eventName} — touch to start`}
    />
  ) : (
    <div className={`default-welcome ${preview ? "mini" : ""}`}>
      <span className="brand-word">
        eazy<span>booth</span>
        <i aria-hidden="true">✳</i>
      </span>
      <div>
        <span className="eyebrow">{settings.eventName}</span>
        <h1>{settings.welcomeText}</h1>
        <span className="welcome-cta">
          Touch anywhere to start <span aria-hidden="true">↗</span>
        </span>
      </div>
      <small>
        PIXEL PRO LAB <span>MADE FOR GOOD MOMENTS</span>
      </small>
    </div>
  );
}
export function Branding({ draft, update, fail }: EditProps) {
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <div className="admin-grid">
      <section className="card">
        <h2>Make it your event</h2>
        <h3>Guest frame choices</h3>
        <p>
          When choices are present, guests select a frame after Welcome. Up to 8 frames;
          each has its own camera layout.
        </p>
        {draft.frames.map((frame, index) => (
          <div className="asset-row" key={frame.id}>
            <label>
              Frame {index + 1} label
              <input
                name={`frame-label-${index}`}
                autoComplete="off"
                maxLength={60}
                value={frame.label}
                onChange={(e) =>
                  update((s) => {
                    s.frames[index].label = e.target.value;
                  })
                }
              />
            </label>
            <img
              className="asset-preview checker"
              width={draft.canvas.width}
              height={draft.canvas.height}
              src={window.booth.media(frame.asset)}
              alt={frame.label}
            />
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                update((s) => {
                  s.frames.splice(index, 1);
                })
              }
            >
              Remove frame {index + 1}
            </button>
          </div>
        ))}
        <button
          disabled={busy || draft.frames.length >= 8}
          onClick={async () => {
            setBusy(true);
            try {
              const asset = await window.booth.pickAsset("frame", draft.canvas);
              if (asset) {
                const opening = await window.booth.frameOpening(asset);
                update((s) => {
                  s.frames.push({
                    id: crypto.randomUUID(),
                    label: `Frame ${s.frames.length + 1}`,
                    asset,
                    geometry: {
                      ...structuredClone(s.geometry),
                      opening,
                      zoom: 1,
                      offsetX: 0,
                      offsetY: 0,
                    },
                  });
                });
              }
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Add guest frame
        </button>
        <label>
          Welcome headline
          <input
            name="welcome-text"
            autoComplete="off"
            value={draft.welcomeText}
            maxLength={160}
            onChange={(e) =>
              update((s) => {
                s.welcomeText = e.target.value;
              })
            }
          />
        </label>
        <label>
          Camera preparing message
          <input
            name="preparing-text"
            autoComplete="off"
            value={draft.preparingText}
            maxLength={160}
            onChange={(e) =>
              update((s) => {
                s.preparingText = e.target.value;
              })
            }
          />
        </label>
        <label>
          Welcome artwork fit
          <select
            value={draft.welcomeFit}
            onChange={(e) =>
              update((s) => {
                s.welcomeFit = e.target.value as Settings["welcomeFit"];
              })
            }
          >
            <option value="cover">Cover screen</option>
            <option value="contain">Contain entire image</option>
          </select>
        </label>
        <label>
          Frame mode
          <select
            value={draft.frameMode}
            onChange={(e) =>
              update((s) => {
                s.frameMode = e.target.value as Settings["frameMode"];
                if (s.frameMode === "none" && s.previewMode === "overlay")
                  s.previewMode = "full";
              })
            }
          >
            <option value="none">None</option>
            <option value="overlay">Overlay Frame</option>
          </select>
        </label>
        {(["welcome", "background", "frame"] as const).map((kind) => (
          <div className="asset-row" key={kind}>
            <h3>
              {kind === "frame"
                ? "Transparent PNG frame"
                : `${kind[0].toUpperCase() + kind.slice(1)} artwork`}
            </h3>
            <p>{draft[kind] ? "Managed copy ready" : "No artwork selected"}</p>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const p = await window.booth.pickAsset(kind, draft.canvas);
                    if (p)
                      update((s) => {
                        s[kind] = p;
                      });
                  } catch (e) {
                    fail(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {draft[kind] ? "Replace" : "Choose"} {kind} artwork
              </button>
              <button
                className="secondary"
                disabled={busy || !draft[kind]}
                onClick={() =>
                  update((s) => {
                    s[kind] = "";
                    if (kind === "frame") {
                      s.frameMode = "none";
                      if (s.previewMode === "overlay") s.previewMode = "full";
                    }
                    if (kind === "background" && s.previewMode === "branded")
                      s.previewMode = "full";
                  })
                }
              >
                Remove {kind}
              </button>
            </div>
          </div>
        ))}
        <p className="hint">
          Welcome/background: still PNG, JPEG or WebP. Frames: transparent PNG matching{" "}
          {draft.canvas.width} × {draft.canvas.height}. Imports are copied into this
          event.
        </p>
      </section>
      <section className="card">
        <h2>Welcome preview</h2>
        <div className="welcome-preview">
          <Welcome settings={draft} preview />
        </div>
        <button className="secondary" onClick={() => setPreview(true)}>
          Preview Guest Screen
        </button>
        {draft.background && (
          <>
            <h3>Stage background</h3>
            <img
              className="asset-preview"
              width={draft.canvas.width}
              height={draft.canvas.height}
              src={window.booth.media(draft.background)}
              alt="Stage background"
            />
          </>
        )}
        {draft.frame && (
          <>
            <h3>Foreground frame</h3>
            <img
              className="asset-preview checker"
              width={draft.canvas.width}
              height={draft.canvas.height}
              src={window.booth.media(draft.frame)}
              alt="Foreground frame"
            />
          </>
        )}
      </section>
      {preview && (
        <Modal title="Guest screen preview" onClose={() => setPreview(false)}>
          <div className="welcome-preview">
            <Welcome settings={draft} preview />
          </div>
          <button onClick={() => setPreview(false)}>Close preview</button>
        </Modal>
      )}
    </div>
  );
}
export function FrameLayout(
  props: EditProps & { video: HTMLVideoElement | null; active: boolean },
) {
  const [id, setId] = useState(props.draft.frames[0]?.id || "");
  const chosen = props.draft.frames.find((f) => f.id === id) || props.draft.frames[0];
  const effective = useMemo(
    () => (chosen ? selectFrame(props.draft, chosen.id) : props.draft),
    [props.draft, chosen?.id],
  );
  if (!chosen) return <LayoutEditor {...props} />;
  return (
    <>
      <label className="frame-layout-select">
        Edit camera layout for
        <select value={chosen.id} onChange={(e) => setId(e.target.value)}>
          {props.draft.frames.map((f) => (
            <option value={f.id} key={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <LayoutEditor
        {...props}
        draft={effective}
        update={(fn) =>
          props.update((s) => {
            const next = selectFrame(s, chosen.id);
            fn(next);
            s.canvas = next.canvas;
            s.printer.orientation = next.printer.orientation;
            if (
              next.canvas.width !== props.draft.canvas.width ||
              next.canvas.height !== props.draft.canvas.height
            )
              for (const f of s.frames)
                f.geometry.opening = { x: 0, y: 0, ...next.canvas };
            s.frames.find((f) => f.id === chosen.id)!.geometry = next.geometry;
            s.previewMode = next.previewMode === "branded" ? "branded" : "full";
          })
        }
      />
    </>
  );
}
export function LayoutEditor({
  draft,
  update,
  fail,
  video,
  active,
}: EditProps & { video: HTMLVideoElement | null; active: boolean }) {
  const box = useRef<HTMLDivElement>(null),
    drag = useRef<{
      x: number;
      y: number;
      rect: Settings["geometry"]["opening"];
      resize: boolean;
    }>();
  const presets = [
    ["4×6 Landscape", 1800, 1200],
    ["4×6 Portrait", 1200, 1800],
    ["16:9 Landscape", 1920, 1080],
    ["Square", 1600, 1600],
  ] as const;
  function size(width: number, height: number) {
    update((s) => {
      s.canvas = { width, height };
      s.geometry.opening = { x: 0, y: 0, width, height };
      s.geometry.offsetX = 0;
      s.geometry.offsetY = 0;
      s.printer.orientation = height > width ? "portrait" : "landscape";
    });
  }
  const num = (
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
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => change(e.target.valueAsNumber)}
      />
    </label>
  );
  const opening = draft.geometry.opening,
    { width: w, height: h } = draft.canvas;
  return (
    <div className="admin-grid">
      <section className="card">
        <h2>Canvas & composition</h2>
        <label>
          Canvas preset
          <select
            value={presets.find((p) => p[1] === w && p[2] === h)?.[0] || "Custom"}
            onChange={(e) => {
              const p = presets.find((p) => p[0] === e.target.value);
              if (p) size(p[1], p[2]);
            }}
          >
            {presets.map((p) => (
              <option key={p[0]}>{p[0]}</option>
            ))}
            <option>Custom</option>
          </select>
        </label>
        <div className="fields">
          {num("Canvas width", w, (n) => size(n, h), 240, 4096)}
          {num("Canvas height", h, (n) => size(w, n), 240, 4096)}
        </div>
        <label>
          Guest live preview mode
          <select
            value={draft.previewMode}
            onChange={(e) =>
              update((s) => {
                s.previewMode = e.target.value as Settings["previewMode"];
              })
            }
          >
            <option value="full">Full Camera</option>
            <option value="overlay">Camera + Overlay Frame</option>
            <option value="branded">Branded Stage</option>
          </select>
        </label>
        <p>
          Drag the camera window to move it. Drag its corner to resize. Full Camera uses
          the whole canvas. Background artwork fills the canvas; use matching dimensions
          to preserve its proportions.
        </p>
        <details open>
          <summary>Advanced placement</summary>
          <div className="fields">
            {(["x", "y", "width", "height"] as const).map((k) => (
              <div key={k}>
                {num(
                  `Camera ${k}`,
                  opening[k],
                  (n) =>
                    update((s) => {
                      s.geometry.opening[k] = n;
                    }),
                  k === "x" || k === "y" ? 0 : 1,
                  k === "x" || k === "width" ? w : h,
                )}
              </div>
            ))}
            {num(
              "Photo zoom",
              draft.geometry.zoom,
              (n) =>
                update((s) => {
                  s.geometry.zoom = n;
                }),
              0.5,
              3,
              0.01,
            )}
            {num(
              "Horizontal offset",
              draft.geometry.offsetX,
              (n) =>
                update((s) => {
                  s.geometry.offsetX = n;
                }),
              -w,
              w,
            )}
            {num(
              "Vertical offset",
              draft.geometry.offsetY,
              (n) =>
                update((s) => {
                  s.geometry.offsetY = n;
                }),
              -h,
              h,
            )}
          </div>
        </details>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.geometry.outputMirror}
            onChange={(e) =>
              update((s) => {
                s.geometry.outputMirror = e.target.checked;
                s.geometry.previewMirror = e.target.checked;
              })
            }
          />
          Mirror camera photo
        </label>
        <p className="hint">
          Artwork never mirrors. Canvas limit: 12 megapixels, up to 4096 pixels per side.
          Reimport a matching frame after changing canvas size.
        </p>
      </section>
      <section className="card">
        <h2>Layout preview</h2>
        <div
          ref={box}
          className="layout-canvas"
          style={{ aspectRatio: `${w}/${h}`, width: `min(100%, ${(65 * w) / h}vh)` }}
        >
          {active ? (
            <Live
              video={video}
              settings={draft}
              active
              onReady={() => {}}
              onError={(s) => fail(Error(s))}
            />
          ) : (
            <>
              {draft.previewMode === "branded" && draft.background && (
                <img
                  width={w}
                  height={h}
                  src={window.booth.media(draft.background)}
                  alt="Stage artwork"
                />
              )}
              <div
                className="camera-placeholder"
                style={
                  draft.previewMode === "full"
                    ? { inset: 0 }
                    : {
                        left: `${(opening.x / w) * 100}%`,
                        top: `${(opening.y / h) * 100}%`,
                        width: `${(opening.width / w) * 100}%`,
                        height: `${(opening.height / h) * 100}%`,
                      }
                }
              >
                CAMERA
              </div>
              {draft.frameMode === "overlay" && draft.frame && (
                <img
                  width={w}
                  height={h}
                  src={window.booth.media(draft.frame)}
                  alt="Frame overlay"
                />
              )}
            </>
          )}
          {draft.previewMode !== "full" && (
            <div
              className="camera-handle"
              role="group"
              aria-label="Camera placement; use Advanced placement for keyboard controls"
              style={{
                left: `${(opening.x / w) * 100}%`,
                top: `${(opening.y / h) * 100}%`,
                width: `${(opening.width / w) * 100}%`,
                height: `${(opening.height / h) * 100}%`,
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  rect: { ...opening },
                  resize: (e.target as HTMLElement).dataset.resize === "true",
                };
              }}
              onPointerMove={(e) => {
                if (!drag.current || !box.current) return;
                const d = drag.current,
                  b = box.current.getBoundingClientRect(),
                  dx = Math.round(((e.clientX - d.x) * w) / b.width),
                  dy = Math.round(((e.clientY - d.y) * h) / b.height);
                update((s) => {
                  s.geometry.opening = d.resize
                    ? {
                        ...d.rect,
                        width: Math.max(1, Math.min(w - d.rect.x, d.rect.width + dx)),
                        height: Math.max(1, Math.min(h - d.rect.y, d.rect.height + dy)),
                      }
                    : {
                        ...d.rect,
                        x: Math.max(0, Math.min(w - d.rect.width, d.rect.x + dx)),
                        y: Math.max(0, Math.min(h - d.rect.height, d.rect.y + dy)),
                      };
                });
              }}
              onPointerUp={() => {
                drag.current = undefined;
              }}
              onPointerCancel={() => {
                drag.current = undefined;
              }}
            >
              <span data-resize="true" className="resize-handle" aria-hidden="true" />
            </div>
          )}
        </div>
        <p className="hint">
          {w} × {h} output pixels · shared preview/final geometry
        </p>
      </section>
    </div>
  );
}
