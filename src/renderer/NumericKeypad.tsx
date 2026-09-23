import { useEffect, useRef } from "react";
export function NumericKeypad({
  label,
  value,
  onChange,
  onConfirm,
  confirmLabel = "Confirm",
  secret = false,
  maxLength = 12,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  confirmLabel?: string;
  secret?: boolean;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <div className="numeric-keypad" role="group" aria-label={`${label} keypad`}>
      <label>
        {label}
        <input
          name={label.toLowerCase().replaceAll(" ", "-")}
          aria-label={label}
          type={secret ? "password" : "text"}
          inputMode="none"
          autoComplete="off"
          readOnly
          value={value}
          onKeyDown={(e) => {
            if (disabled) return;
            if (/^\d$/.test(e.key)) {
              e.preventDefault();
              onChange((value + e.key).slice(0, maxLength));
            }
            if (e.key === "Backspace") {
              e.preventDefault();
              onChange(value.slice(0, -1));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm();
            }
          }}
          onPaste={(e) => {
            if (!disabled)
              onChange(
                e.clipboardData.getData("text").replace(/\D/g, "").slice(0, maxLength),
              );
          }}
        />
      </label>
      <div className="keypad-grid">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Backspace"].map(
          (key) => (
            <button
              type="button"
              className="secondary"
              key={key}
              disabled={disabled}
              onClick={() =>
                onChange(
                  key === "Clear"
                    ? ""
                    : key === "Backspace"
                      ? value.slice(0, -1)
                      : (value + key).slice(0, maxLength),
                )
              }
            >
              {key}
            </button>
          ),
        )}
      </div>
      <button
        type="button"
        className="keypad-confirm"
        disabled={disabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="scrim">
      <div
        className="pin-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onClose) {
            e.stopPropagation();
            onClose();
          }
          if (e.key !== "Tab") return;
          const items = Array.from(
            ref.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
            ),
          );
          const first = items[0],
            last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
          if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
