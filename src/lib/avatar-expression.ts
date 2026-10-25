/** Presentation-only expressions derived from the existing hidden transcription. */
export type MahiruEmotion =
  | "neutral" | "happy" | "excited" | "amused" | "shy" | "sad" | "teary"
  | "annoyed" | "surprised" | "confused" | "thinking" | "concerned" | "sleepy" | "laughing";

export type Expression = { brow: number; tilt: number; smile: number; eye: number; blush: number; head: number; tears: number };
const base: Expression = { brow: 0, tilt: 0, smile: .3, eye: 1, blush: .12, head: 0, tears: 0 };
export const EXPRESSIONS: Record<MahiruEmotion, Expression> = {
  neutral: base,
  happy: { ...base, smile: .9, eye: .9, blush: .3, head: 1 },
  excited: { ...base, brow: 4, smile: 1, eye: 1.08, blush: .4 },
  amused: { ...base, smile: .8, eye: .78, head: -2, brow: 1 },
  shy: { ...base, smile: .55, blush: .85, eye: .86, head: 3, tilt: 2 },
  sad: { ...base, smile: -.55, tilt: 6, eye: .85, head: -2 },
  teary: { ...base, smile: -.65, tilt: 7, eye: .88, tears: .9, blush: .32 },
  annoyed: { ...base, tilt: -7, smile: -.45, eye: .72, brow: -2 },
  surprised: { ...base, brow: 7, smile: -.1, eye: 1.12 },
  confused: { ...base, tilt: 4, brow: 2, smile: -.15, head: -4 },
  thinking: { ...base, brow: 1, tilt: 2, smile: .05, eye: .85, head: -3 },
  concerned: { ...base, tilt: 5, smile: -.3, eye: .95, head: 1 },
  sleepy: { ...base, eye: .46, smile: .1, head: 2 },
  laughing: { ...base, eye: .28, smile: 1.2, blush: .4, head: 2 },
};

export function inferEmotion(text: string): MahiruEmotion | null {
  const t = text.toLowerCase();
  if (/\b(crying|tears|tearful|sob|heartbroken)\b/.test(t)) return "teary";
  if (/\b(hahaha|laughing|hilarious|can't stop laughing)\b/.test(t)) return "laughing";
  if (/\b(annoyed|angry|frustrating|irritating|ugh)\b/.test(t)) return "annoyed";
  if (/\b(blushing|embarrassed|shy|flattered)\b/.test(t)) return "shy";
  if (/\b(sleepy|yawn|drowsy|bedtime)\b/.test(t)) return "sleepy";
  if (/\b(confused|puzzled|don't understand|not sure what you mean)\b/.test(t)) return "confused";
  if (/\b(excited|can't wait|so exciting|thrilled)\b/.test(t)) return "excited";
  if (/\b(sad|lonely|miss you|disappointed)\b/.test(t)) return "sad";
  if (/(haha|hehe|lol|funny|silly|ha!|teas)/.test(t)) return "amused";
  if (/(wow|whoa|really\?|no way|seriously|what\?!|oh!)/.test(t)) return "surprised";
  if (/(sorry|oh no|that's hard|tough|worried|are you okay|hurt)/.test(t)) return "concerned";
  if (/(hmm|let me think|maybe|i wonder|perhaps|well\.\.\.)/.test(t)) return "thinking";
  if (/(yay|great|love|awesome|glad|happy|nice|amazing|perfect|!)/.test(t)) return "happy";
  return null;
}