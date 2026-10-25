import { describe, expect, it } from "vitest";
import { EXPRESSIONS, inferEmotion, type MahiruEmotion } from "../lib/avatar-expression";

describe("Mahiru visual expressions", () => {
  const cases: [string, MahiruEmotion][] = [
    ["I'm happy!", "happy"], ["I'm excited", "excited"], ["hehe, silly", "amused"],
    ["I'm blushing", "shy"], ["I'm sad", "sad"], ["tears", "teary"],
    ["ugh, annoying", "annoyed"], ["wow", "surprised"], ["I'm confused", "confused"],
    ["hmm, let me think", "thinking"], ["are you okay", "concerned"],
    ["feeling sleepy", "sleepy"], ["hahaha", "laughing"],
  ];
  it.each(cases)("maps %s to %s without changing the session", (text, expected) => {
    expect(inferEmotion(text)).toBe(expected);
    expect(EXPRESSIONS[expected]).toBeDefined();
  });
  it("keeps neutral and teary distinct", () => {
    expect(EXPRESSIONS.neutral.tears).toBe(0);
    expect(EXPRESSIONS.teary.tears).toBe(.9);
    expect(inferEmotion("the book is on the table")).toBeNull();
  });
});