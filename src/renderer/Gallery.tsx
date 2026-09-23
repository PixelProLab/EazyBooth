import { useEffect, useRef, useState } from "react";
import { NumericKeypad, Modal } from "./NumericKeypad";
import type { PhotoPage, SavedPhoto, PrintResult, Settings } from "../shared/types";

export function Gallery({
  printer,
  onPrinting,
  maxCopies,
}: {
  maxCopies: number;
  printer: Settings["printer"];
  onPrinting: (busy: boolean) => void;
}) {
  const [quantityOpen, setQuantityOpen] = useState(false),
    [quantity, setQuantity] = useState("1");
  const lastCopies = useRef(1);
  const [page, setPage] = useState(0),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<PhotoPage>(),
    [selected, setSelected] = useState<SavedPhoto>(),
    [url, setUrl] = useState(""),
    [original, setOriginal] = useState(false),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(false),
    [printing, setPrinting] = useState(false),
    [printResult, setPrintResult] = useState<PrintResult>();
  const generation = useRef(0),
    printLock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");
    window.booth
      .photos(page)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setMessage(String(e.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, revision]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function view(photo: SavedPhoto, raw = false) {
    if (printLock.current) return;
    const token = ++generation.current;
    setSelected(photo);
    setOriginal(raw);
    setUrl("");
    setMessage("");
    setPrintResult(undefined);
    try {
      const next = await window.booth.photo(photo.id, raw);
      if (token === generation.current) setUrl(next);
    } catch (e) {
      if (token === generation.current) setMessage(String(e));
    }
  }
  async function printSaved(copies = printer.copies) {
    if (!selected || printLock.current) return;
    lastCopies.current = copies;
    setQuantityOpen(false);
    printLock.current = true;
    const token = generation.current;
    setPrinting(true);
    setPrintResult(undefined);
    setMessage("");
    onPrinting(true);
    try {
      const result = await window.booth.printSaved(
        selected.id,
        crypto.randomUUID(),
        copies,
      );
      if (token === generation.current) setPrintResult(result);
    } catch {
      if (token === generation.current)
        setPrintResult({
          status: "unknown",
          message:
            "Unable to confirm the print request. Check the Windows queue before retrying.",
        });
    } finally {
      printLock.current = false;
      if (token === generation.current) {
        setPrinting(false);
        onPrinting(false);
      }
    }
  }
  const fail = (e: unknown) => setMessage(String(e));
  return (
    <section className="card gallery">
      <h2>Saved photos</h2>
      {quantityOpen && (
        <Modal title="Saved photo More Prints" onClose={() => setQuantityOpen(false)}>
          <h2>More Prints</h2>
          <p>Choose 1–{maxCopies} copies.</p>
          <NumericKeypad
            label="Print quantity"
            value={quantity}
            onChange={setQuantity}
            maxLength={2}
            onConfirm={() => {
              const n = Number(quantity);
              if (!Number.isInteger(n) || n < 1 || n > maxCopies) {
                setMessage(`Choose 1–${maxCopies} copies`);
                return;
              }
              void printSaved(n);
            }}
          />
          <p role="alert">{message}</p>
          <button className="secondary" onClick={() => setQuantityOpen(false)}>
            Cancel
          </button>
        </Modal>
      )}
      <p>
        Every capture is saved automatically, including retakes. Originals and framed
        photos remain on this computer.
      </p>
      <div className="actions">
        <button
          className="secondary"
          disabled={printing}
          onClick={() => window.booth.openStorage().catch(fail)}
        >
          Open photos folder
        </button>
        <button
          className="secondary"
          disabled={loading || printing}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh photos
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      {selected ? (
        <div>
          <div className="actions">
            <button
              className="secondary"
              disabled={printing}
              onClick={() => {
                generation.current++;
                setSelected(undefined);
                setUrl("");
                setPrintResult(undefined);
                setRevision((n) => n + 1);
              }}
            >
              Back to photos
            </button>
            <button
              className="secondary"
              disabled={printing}
              onClick={() => void view(selected, !original)}
            >
              {original ? "View framed photo" : "View original"}
            </button>
            <button
              className="secondary"
              disabled={printing}
              onClick={() => window.booth.revealPhoto(selected.id).catch(fail)}
            >
              Show in folder
            </button>
            <button
              disabled={printing || !printer.name}
              onClick={() =>
                void printSaved(
                  printResult && printResult.status !== "accepted"
                    ? lastCopies.current
                    : printer.copies,
                )
              }
            >
              {printing
                ? "Printing…"
                : printResult?.status === "accepted"
                  ? "Print again"
                  : printResult?.status === "unknown"
                    ? "I checked the queue — Retry"
                    : printResult?.status === "failed"
                      ? "Retry print"
                      : "Print framed photo"}
            </button>
            <button
              className="secondary"
              disabled={printing || !printer.name || printResult?.status === "unknown"}
              onClick={() => {
                setQuantity(String(Math.min(printer.copies, maxCopies)));
                setQuantityOpen(true);
              }}
            >
              More Prints
            </button>
            {printResult && printResult.status !== "accepted" && (
              <button
                className="secondary"
                onClick={() => {
                  if (printResult?.status !== "unknown") setPrintResult(undefined);
                  else {
                    generation.current++;
                    setSelected(undefined);
                    setUrl("");
                    setPrintResult(undefined);
                    setRevision((n) => n + 1);
                  }
                }}
              >
                Cancel retry
              </button>
            )}
          </div>
          <p>
            {printer.name
              ? `Printer: ${printer.name} · Copies: ${printer.copies}. Uses saved printer settings and the framed photo.`
              : "Select and save a printer in Printing before printing this photo."}
          </p>
          {printing && (
            <p role="status">Waiting for Windows to accept the saved photo…</p>
          )}
          {printResult && (
            <p role={printResult.status === "accepted" ? "status" : "alert"}>
              {printResult.message}
            </p>
          )}
          <p>
            {new Date(selected.created).toLocaleString()} ·{" "}
            {original ? "Original" : "Framed photo"}
          </p>
          {url ? (
            <img
              width={1800}
              height={1200}
              className="gallery-preview"
              src={url}
              alt={original ? "Saved original photo" : "Saved framed photo"}
            />
          ) : (
            <p role="status">Loading photo…</p>
          )}
        </div>
      ) : (
        <>
          <p role="status">
            {loading ? "Loading saved photos…" : `${data?.total || 0} saved photos`}
          </p>
          <div className="photo-grid">
            {data?.items.map((photo) => (
              <button
                className="photo-card secondary"
                key={photo.id}
                onClick={() => void view(photo)}
              >
                {photo.thumbnail ? (
                  <img
                    width={360}
                    height={240}
                    loading="lazy"
                    src={photo.thumbnail}
                    alt="Saved photo thumbnail"
                  />
                ) : (
                  <span>Preview unavailable</span>
                )}
                <span>{new Date(photo.created).toLocaleString()}</span>
                <small>
                  {photo.approved ? "Approved" : "Saved"} · {photo.printStatus}
                </small>
              </button>
            ))}
          </div>
          <div className="actions">
            <button
              className="secondary"
              disabled={loading || page === 0}
              onClick={() => setPage(page - 1)}
            >
              Newer photos
            </button>
            <button
              className="secondary"
              disabled={loading || !data || (page + 1) * 24 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              Older photos
            </button>
          </div>
        </>
      )}
    </section>
  );
}
