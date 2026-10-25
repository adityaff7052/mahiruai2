/** Disabled: camera presence must never cause unsolicited speech. */
export const PRESENCE_DEFAULTS = { enabled: false, sustainedMs: 7000, cooldownMs: 120000, speechQuietMs: 6000, sampleMs: 1000 };
export class PresencePolicy {
  private since: number | null = null;
  private lastUtterance = -Infinity;
  private lastSpeech = -Infinity;
  constructor(readonly config = PRESENCE_DEFAULTS) {}
  cancel(now: number) { this.since = null; this.lastSpeech = now; }
  update(now: number, attentive: boolean, available: boolean, speaking: boolean) {
    if (speaking) this.cancel(now);
    if (!this.config.enabled || !attentive || !available || speaking || now - this.lastSpeech < this.config.speechQuietMs) { this.since = null; return false; }
    this.since ??= now;
    if (now - this.since < this.config.sustainedMs || now - this.lastUtterance < this.config.cooldownMs) return false;
    this.lastUtterance = now; this.since = null; return true;
  }
}
