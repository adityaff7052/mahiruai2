import { describe, expect, it } from "vitest";
import { isEntryCodeValid } from "@/lib/entry-gate";
import { MAHIRU_VOICE } from "@/lib/mahiru-config";

describe("entry gate", () => {
  it("accepts exactly 8917", () => expect(isEntryCodeValid("8917")).toBe(true));
  it("rejects other codes", () => {
    for (const code of ["", "705", "70520", "1234", "2507", "7052"]) expect(isEntryCodeValid(code)).toBe(false);
  });
});

describe("voice", () => {
  it("uses the Leda prebuilt voice", () => expect(MAHIRU_VOICE).toBe("Leda"));
});
