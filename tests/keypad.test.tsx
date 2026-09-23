// @vitest-environment jsdom
import { it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { NumericKeypad } from "../src/renderer/NumericKeypad";
afterEach(cleanup);
it.each([true, false])(
  "numeric keypad uses touch buttons with no QWERTY keyboard, secret=%s",
  (secret) => {
    const confirm = vi.fn();
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <NumericKeypad
          label={secret ? "Operator PIN" : "Print quantity"}
          value={value}
          onChange={setValue}
          onConfirm={() => confirm(value)}
          secret={secret}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    const input = screen.getByLabelText(
      secret ? "Operator PIN" : "Print quantity",
    ) as HTMLInputElement;
    expect(input.value).toBe("13");
    expect(input.readOnly).toBe(true);
    expect(input.inputMode).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Backspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(confirm).toHaveBeenCalledWith("1");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "a" });
    expect(input.value).toBe("");
  },
);
