export function mouthAmplitude(previous: number, output: number, speaking: boolean, dt: number) {
  if (!speaking) return 0;
  const target = Math.min(1, Math.max(0, output) * 7);
  return previous + (target - previous) * (1 - Math.exp(-Math.min(dt, 50) / (target > previous ? 28 : 65)));
}

/** A quick closing lid and slower reopening, with no lingering closed-eye frame. */
export function blinkClosure(elapsed: number) {
  if (elapsed < 0 || elapsed >= 190) return 0;
  const phase = elapsed / 190;
  return phase < .38 ? Math.sin(phase / .38 * Math.PI / 2) : Math.cos((phase - .38) / .62 * Math.PI / 2);
}

export function mouthPose(amplitude: number, smile: number) {
  const open = Math.min(1, Math.max(0, amplitude) * 1.4);
  // Silence never exposes an open-mouth raster, even for laughing expressions.
  const wide = open === 0 ? 0 : Math.min(1, Math.max(0, (open - .35) / .5 + Math.max(0, smile) * .18));
  return { open, small: open * (1 - wide), wide: open * wide };
}

/** Small, independently phased rotations around the crown/side-lock attachment. */
export function hairAngles(seconds: number, output: number, reduced: boolean) {
  if (reduced) return { bangs: 0, left: 0, right: 0 };
  const energy = 1 + Math.min(1, Math.max(0, output)) * .3;
  return {
    bangs: Math.sin(seconds * .83) * .0012 * energy,
    left: Math.sin(seconds * .67 + .8) * .0025 * energy,
    right: Math.sin(seconds * .73 + 2.1) * .0022 * energy,
  };
}
