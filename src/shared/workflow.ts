export type Phase =
  | "welcome"
  | "frame-selection"
  | "preview"
  | "countdown"
  | "saving"
  | "review"
  | "printing"
  | "print-error"
  | "complete"
  | "camera-error";
export class Generation {
  private value = 0;
  next() {
    return ++this.value;
  }
  current() {
    return this.value;
  }
  is(v: number) {
    return this.value === v;
  }
}
export function canReset(phase: Phase) {
  return phase !== "printing";
}
