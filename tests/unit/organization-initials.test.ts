import { describe, expect, it } from "vitest";
import {
  getOrganizationInitials,
  getOrganizationLabel,
} from "@/lib/organization-initials";

describe("getOrganizationInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(getOrganizationInitials("Acme Labs")).toBe("AL");
    expect(getOrganizationInitials("Sandbox for TechOps")).toBe("SF");
  });

  it("uses one letter for a one-word name", () => {
    expect(getOrganizationInitials("Personal")).toBe("P");
  });

  it("upper-cases and ignores extra spaces", () => {
    expect(getOrganizationInitials("  defi   ops ")).toBe("DO");
  });

  it("keeps a character made of two code units whole", () => {
    expect(getOrganizationInitials("𝔸cme labs")).toBe("𝔸L");
  });

  it("keeps a flag or an emoji sequence whole", () => {
    expect(getOrganizationInitials("🇺🇸 Team")).toBe("🇺🇸T");
    expect(getOrganizationInitials("👩‍💻 Devs")).toBe("👩‍💻D");
  });

  it("keeps an accent typed as a separate mark on its letter", () => {
    expect(getOrganizationInitials("e\u0301cole Labs")).toBe("E\u0301L");
  });

  it("leaves a letter whose upper case is two letters as it is", () => {
    expect(getOrganizationInitials("ßeta Labs")).toBe("ßL");
  });

  it("falls back to a question mark for an empty name", () => {
    expect(getOrganizationInitials("   ")).toBe("?");
  });
});

describe("getOrganizationLabel", () => {
  it("adds the initials to a name of several words", () => {
    expect(getOrganizationLabel("Acme Labs")).toBe("Acme Labs (AL)");
  });

  it("adds them even when the name starts with the same letters", () => {
    // The button shows "AL"; voice control matches words, not letters.
    expect(getOrganizationLabel("Alpha Labs")).toBe("Alpha Labs (AL)");
    expect(getOrganizationLabel("Ethan Test")).toBe("Ethan Test (ET)");
  });

  it("leaves a one-word name as it is", () => {
    expect(getOrganizationLabel("Personal")).toBe("Personal");
    expect(getOrganizationLabel("AB")).toBe("AB");
  });

  it("trims the name", () => {
    expect(getOrganizationLabel("  Personal ")).toBe("Personal");
    expect(getOrganizationLabel(" Acme  Labs ")).toBe("Acme  Labs (AL)");
  });

  it("falls back to the initials' question mark for an empty name", () => {
    expect(getOrganizationLabel("   ")).toBe("?");
  });
});
