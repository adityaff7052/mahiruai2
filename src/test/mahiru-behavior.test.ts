import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MAHIRU_PERSONA, MAHIRU_VOICE, buildLiveConfig } from "@/lib/mahiru-config";
import { PresencePolicy, PRESENCE_DEFAULTS } from "@/lib/presence-policy";
import { isEntryCodeValid } from "@/lib/entry-gate";
import { isStopCommand } from "@/lib/stop-command";
import type { Modality } from "@google/genai";

describe("Mahiru behavior", () => {
  it("default persona is polite and forbids teasing, pet names and unsolicited camera remarks", () => {
    expect(MAHIRU_PERSONA).toMatch(/respectful, polite, calm/);
    expect(MAHIRU_PERSONA).toMatch(/Never use pet names or romantic language/);
    expect(MAHIRU_PERSONA).toMatch(/Never comment on a person's appearance/);
    expect(MAHIRU_PERSONA).not.toMatch(/witty|lightly teasing|playful young adult/);
  });
  it("token constraints and connection share the single persona", () => {
    expect(buildLiveConfig({ AUDIO: "AUDIO" as Modality }).systemInstruction).toBe(MAHIRU_PERSONA);
    expect(readFileSync("src/lib/live-token.functions.ts", "utf8")).not.toMatch(/systemInstruction/);
  });
  it("camera presence alone does not trigger unsolicited narration", () => {
    expect(PRESENCE_DEFAULTS.enabled).toBe(false);
    const p = new PresencePolicy();
    for (let t = 0; t <= 300000; t += 500) expect(p.update(t, true, true, false)).toBe(false);
    expect(readFileSync("src/hooks/use-mahiru-live.ts", "utf8")).toMatch(/camera frames are supplied for visual question answering/i);
  });
  it("recognizes English and Hindi stop commands without broad ordinary-word matches", () => {
    for (const phrase of ["stop", "please stop talking", "enough", "ruko", "ruk jao", "bas karo", "band kar do", "रुको", "रुक जाओ", "बस करो", "बंद करो", "चुप हो जाओ", "मत बोलो", "स्टॉप"]) {
      expect(isStopCommand(phrase), phrase).toBe(true);
    }
    expect(isStopCommand("I want to go to school")).toBe(false);
    expect(isStopCommand("we should stop by the shop tomorrow")).toBe(false);
    expect(isStopCommand("bas ek baat aur")).toBe(false);
    expect(isStopCommand("बस में जाना है")).toBe(false);
  });
  it("keeps Leda voice and code 8917", () => {
    expect(MAHIRU_VOICE).toBe("Leda");
    expect(isEntryCodeValid("8917")).toBe(true);
  });
});
