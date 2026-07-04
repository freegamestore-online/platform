import { describe, it, expect, beforeEach } from "vitest";
import { getTextSize, applyTextSize, TEXT_SIZES } from "./textSize";

describe("textSize", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 'default' with nothing (or an invalid value) stored", () => {
    expect(getTextSize()).toBe("default");
    localStorage.setItem("stores-text-size", "not-a-size");
    expect(getTextSize()).toBe("default");
  });

  it("round-trips each valid size through localStorage", () => {
    for (const { value } of TEXT_SIZES) {
      applyTextSize(value);
      expect(getTextSize()).toBe(value);
    }
  });

  it("sets html[data-text] for non-default and clears it for default", () => {
    applyTextSize("xl");
    expect(document.documentElement.dataset.text).toBe("xl");
    applyTextSize("default");
    expect(document.documentElement.dataset.text).toBeUndefined();
  });

  it("exposes the four sizes with labels", () => {
    expect(TEXT_SIZES.map((t) => t.value)).toEqual(["sm", "default", "lg", "xl"]);
  });
});
