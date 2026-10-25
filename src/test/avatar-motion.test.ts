import { describe, expect, it } from 'vitest';
import { blinkClosure, hairAngles, mouthAmplitude, mouthPose } from '../lib/avatar-motion';

describe('presentation-only raster rig', () => {
  it('closes and reopens a natural blink without an idle closed lid', () => {
    expect(blinkClosure(-1)).toBe(0);
    expect(blinkClosure(0)).toBe(0);
    expect(blinkClosure(72.2)).toBeCloseTo(1);
    expect(blinkClosure(160)).toBeGreaterThan(0);
    expect(blinkClosure(190)).toBe(0);
  });
  it('closes all speaking poses immediately when interrupted or silent', () => {
    const interrupted = mouthAmplitude(.9, 1, false, 16);
    expect(interrupted).toBe(0);
    expect(mouthPose(interrupted, 1.2)).toEqual({ open: 0, small: 0, wide: 0 });
    expect(mouthPose(0, .9).open).toBe(0);
  });
  it('uses a small vowel for quiet output and wide articulation for louder output', () => {
    const quiet = mouthPose(.1, .3);
    const loud = mouthPose(.8, .9);
    expect(quiet.small).toBeGreaterThan(quiet.wide);
    expect(loud.wide).toBeGreaterThan(loud.small);
    expect(loud.small + loud.wide).toBeCloseTo(loud.open);
  });
  it('keeps independently pivoted hair restrained and still for reduced motion', () => {
    expect(hairAngles(3, 1, true)).toEqual({ bangs: 0, left: 0, right: 0 });
    const angles = hairAngles(3, 1, false);
    expect(angles.left).not.toBe(angles.right);
    for (const value of Object.values(angles)) expect(Math.abs(value)).toBeLessThan(.004);
  });
});