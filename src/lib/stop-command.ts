/** Recognizes explicit stop/hold commands while Mahiru is speaking. */
export function isStopCommand(transcript: string): boolean {
  const text = transcript
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[.,!?;:…—–।॥-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;

  // Treat English stop words as commands when the phrase itself is directive;
  // avoid false positives for sentences such as "we should stop by the shop".
  if (/^(?:(?:please|can you|could you|would you)\s+)?(?:stop|pause|halt|quiet|silence|enough|cancel|wait|quit|be quiet|stay quiet|shut up|that's enough|thats enough|no more|hold on|hold it|quit it|not anymore)(?:\s+(?:now|it|please|talking|speaking|this|that|the audio|the music|for a moment))*$/i.test(text)) return true;
  if (/\b(?:please stop|can you stop|could you stop|stop it|stop talking|stop speaking|shut up|that['’]s enough|thats enough|enough now|no more|hold on|hold it|quit it|not anymore)\b/i.test(text)) return true;

  const latinPhrases = [
    "ruk jao", "ruk ja", "ruk jao zara", "ruko zara", "ruko ab", "ab ruko", "rukiye zara", "rukiye",
    "bas karo", "bas kar", "ab bas", "bas ab", "band karo", "band kar do", "band kar", "bolna band karo",
    "chup ho jao", "chup raho", "chup karo", "mat bolo", "aage mat bolo", "ab mat bolo", "rok do",
    "roko", "thehro", "thahro", "thahariye", "rehne do", "bohot hua", "bahut hua", "kaafi hai", "kafi hai", "shant ho jao",
  ];
  if (latinPhrases.some((phrase) => (` ${text} `).includes(` ${phrase} `))) return true;
  const latinTokens = new Set(text.split(" "));
  if ((text === "bas" || text === "bass") || ["ruko", "chup", "roko", "thehro", "thahro", "rukiye"].some((word) => latinTokens.has(word))) return true;

  // Hindi words don't fit JavaScript's traditional ASCII-only \b word boundaries.
  const hindiPhrases = [
    "रुक जाओ", "रुक जाइए", "अभी रुको", "अब रुको", "रुको ज़रा", "रुको जरा", "रुकिए",
    "बस करो", "अब बस", "बस अब", "बंद करो", "बंद कर दो", "बोलना बंद करो", "चुप हो जाओ",
    "चुप रहो", "चुप करो", "अब चुप", "मत बोलो", "आगे मत बोलो", "अब मत बोलो", "रोक दो", "रोकिए",
    "ठहरो", "ठहरिए", "रहने दो", "बहुत हुआ", "काफी है", "काफ़ी है", "थोड़ा रुको", "थोड़ा रुको",
    "बस कर", "बस अब", "अभी बस", "बंद कर", "चुप हो जाओ", "शांत हो जाओ", "स्टॉप करो", "स्टॉप", "रुक",
  ];
  if (hindiPhrases.some((phrase) => (` ${text} `).includes(` ${phrase} `))) return true;
  const hindiTokens = new Set(text.split(" "));
  if (text === "बस") return true;
  return ["चुप", "रुको", "रुकिए", "रुक", "ठहरो", "ठहरिए", "स्टॉप"].some((word) => hindiTokens.has(word));
}

type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & { isFinal?: boolean };
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorLike = { error?: string };
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};
type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Uses the browser's speech recognition only during Mahiru's spoken output. This
 * keeps ordinary background voices away from Gemini and lets a stop command be
 * detected locally without causing Gemini's normal barge-in behavior.
 */
export class StopCommandListener {
  private recognition: RecognitionLike | null = null;
  private active = false;
  private unavailable = false;
  private restartTimer: number | null = null;
  private commandLatched = false;

  constructor(private readonly onStop: () => void, private readonly onUnsupported?: () => void) {}

  get supported() {
    return typeof window !== "undefined" && recognitionConstructor() !== null;
  }

  start() {
    if (this.active || this.unavailable) return;
    this.active = true;
    this.commandLatched = false;
    this.launch();
  }

  stop() {
    this.active = false;
    if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try { recognition.stop(); } catch { /* It may already have stopped. */ }
      try { recognition.abort?.(); } catch { /* Browser-specific cleanup. */ }
    }
  }

  private launch() {
    if (!this.active || typeof window === "undefined") return;
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      this.active = false;
      this.unavailable = true;
      this.onUnsupported?.();
      return;
    }

    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = "hi-IN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 4;
    recognition.onresult = (event) => {
      if (!this.active || this.commandLatched) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result || result.isFinal !== true) continue;
        for (let j = 0; j < result.length; j++) {
          const alternative = result[j];
          if (alternative && isStopCommand(alternative.transcript)) {
            this.commandLatched = true;
            this.stop();
            this.onStop();
            return;
          }
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.active = false;
        this.unavailable = true;
        this.onUnsupported?.();
      }
    };
    recognition.onend = () => {
      if (!this.active) return;
      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        this.launch();
      }, 250);
    };
    try {
      recognition.start();
    } catch {
      // Some browsers emit onend before start() can be called again; retry gently.
      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        if (this.active) this.launch();
      }, 500);
    }
  }
}
