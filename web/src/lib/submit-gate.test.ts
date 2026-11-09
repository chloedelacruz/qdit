import { describe, expect, it } from "vitest";

import { createSubmitGate } from "./submit-gate";

describe("createSubmitGate", () => {
  it("lets the first submit through and refuses the second until released", () => {
    const gate = createSubmitGate();
    expect(gate.enter()).toBe(true);
    expect(gate.busy).toBe(true);
    expect(gate.enter()).toBe(false);
    expect(gate.enter()).toBe(false);

    gate.release();
    expect(gate.busy).toBe(false);
    expect(gate.enter()).toBe(true);
  });

  it("keeps separate gates apart", () => {
    const a = createSubmitGate();
    const b = createSubmitGate();
    a.enter();
    expect(b.enter()).toBe(true);
  });
});
