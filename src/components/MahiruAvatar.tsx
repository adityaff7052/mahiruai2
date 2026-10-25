import { useEffect, useRef } from 'react';
import portrait from '@/assets/mahiru-portrait.png';
import cleanArt from '@/assets/mahiru-base.png';
import speakingArt from '@/assets/mahiru-speaking.png';
import roundedArt from '@/assets/mahiru-rounded.png';
import blinkArt from '@/assets/mahiru-blink.png';
import tearyArt from '@/assets/mahiru-teary.png';
import { EXPRESSIONS, type MahiruEmotion, type Expression } from '@/lib/avatar-expression';
import { blinkClosure, hairAngles, mouthAmplitude, mouthPose } from '@/lib/avatar-motion';
import { ART_WIDTH as W, ART_HEIGHT, FRAME_HEIGHT as H, RIG, HAIR_PARTS, type Region } from '@/lib/avatar-rig';
import type { MahiruState } from '@/hooks/use-mahiru-live';
interface Props { state: MahiruState; emotion: MahiruEmotion; getOutputLevel: () => number; getInputLevel: () => number }

function surface() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = ART_HEIGHT;
  return canvas;
}

/** Mask at native resolution; feather only the seam, keeping lashes/lips fully opaque. */
function masked(img: HTMLImageElement, region: Region, core = .76) {
  const c = surface(), g = c.getContext('2d');
  if (!g) return c;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.save(); g.translate(region.x, region.y); g.scale(1, region.ry / region.rx);
  const gradient = g.createRadialGradient(0, 0, region.rx * core, 0, 0, region.rx);
  gradient.addColorStop(0, 'rgba(0,0,0,1)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient; g.fillRect(-region.rx, -region.rx, region.rx * 2, region.rx * 2);
  g.restore(); return c;
}

function hairPart(img: HTMLImageElement, path: string) {
  const c = surface(), g = c.getContext('2d');
  if (!g) return c;
  // Soft silhouette masks rather than shifted rectangular image copies.
  const mask = surface(), mg = mask.getContext('2d');
  if (!mg) return c;
  mg.fillStyle = 'black'; mg.fill(new Path2D(path));
  g.drawImage(img, 0, 0); g.globalCompositeOperation = 'destination-in';
  g.filter = 'blur(2px)'; g.drawImage(mask, 0, 0); g.filter = 'none';
  return c;
}

type Feature = { neutral: HTMLCanvasElement; happy: HTMLCanvasElement; sad: HTMLCanvasElement; closed: HTMLCanvasElement };
type Layers = {
  base: HTMLImageElement;
  eyes: { region: Region; clean: HTMLCanvasElement; art: Feature }[];
  brows: { region: Region; neutral: HTMLCanvasElement; happy: HTMLCanvasElement; sad: HTMLCanvasElement }[];
  mouth: { clean: HTMLCanvasElement; neutral: HTMLCanvasElement; round: HTMLCanvasElement; wide: HTMLCanvasElement; sad: HTMLCanvasElement };
  tears: HTMLCanvasElement[];
  hair: { art: HTMLCanvasElement; definition: typeof HAIR_PARTS[number] }[];
};

/** Native-resolution raster rig, preserving the original face, hoodie and silver necklace. */
export function MahiruAvatar(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props); live.current = props;
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const load = (src: string) => new Promise<HTMLImageElement>((ok, bad) => {
      const img = new Image(); img.onload = () => ok(img); img.onerror = bad; img.src = src;
    });
    let layers: Layers | null = null;
    const blushColor = getComputedStyle(el).getPropertyValue('--mahiru-blush').trim();
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, disposed = false, last = performance.now(), blink = -1;
    let nextBlink = last + 1600, mouth = 0, interruptedAt = -1;
    let gazeX = 0, gazeY = 0, targetX = 0, targetY = 0, nextGaze = last + 1300;
    const current: Expression = { ...EXPRESSIONS.neutral };
    void Promise.all([portrait, cleanArt, blinkArt, speakingArt, roundedArt, tearyArt].map(load)).then(([b, clean, bl, sp, ro, te]) => {
      if (disposed || !b || !clean || !bl || !sp || !ro || !te) return;
      layers = {
        base: b,
        eyes: [RIG.leftEye, RIG.rightEye].map(region => ({ region, clean: masked(clean, region), art: {
          neutral: masked(b, region), happy: masked(sp, region), sad: masked(te, region), closed: masked(bl, region),
        } })),
        brows: [RIG.leftBrow, RIG.rightBrow].map(region => ({ region, neutral: masked(b, region), happy: masked(sp, region), sad: masked(te, region) })),
        mouth: { clean: masked(clean, RIG.mouth), neutral: masked(b, RIG.mouth), round: masked(ro, RIG.mouth), wide: masked(sp, RIG.mouth), sad: masked(te, RIG.mouth) },
        tears: [masked(te, RIG.leftTear), masked(te, RIG.rightTear)],
        hair: HAIR_PARTS.map(definition => ({ definition, art: hairPart(b, definition.path) })),
      };
      el.dataset['artReady'] = 'true';
    }).catch(() => console.warn('[mahiru] Avatar artwork failed to load'));

    const draw = (art: CanvasImageSource, alpha = 1, x = 0, y = 0) => {
      if (alpha <= .001) return;
      ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(art, x, y);
    };
    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min(50, now - last); last = now;
      if (layers) {
        const { state, emotion, getOutputLevel, getInputLevel } = live.current;
        const reduced = motionPreference.matches;
        const key = state === 'error' ? 'concerned' : state === 'thinking' ? 'thinking' : state === 'interrupted' ? 'neutral' : emotion;
        const target = EXPRESSIONS[key], ease = 1 - Math.exp(-dt / 320);
        for (const k of Object.keys(current) as (keyof Expression)[]) current[k] += (target[k] - current[k]) * ease;
        const output = state === 'speaking' ? getOutputLevel() : 0;
        mouth = mouthAmplitude(mouth, output, state === 'speaking', dt);
        if (state === 'interrupted') interruptedAt = now;
        if (now > nextBlink && blink < 0) blink = now;
        const lid = blink < 0 ? 0 : blinkClosure(now - blink);
        if (blink >= 0 && now - blink >= 190) {
          blink = -1; nextBlink = now + (Math.random() < .15 ? 260 : 2400 + Math.random() * 3800);
        }
        if (now > nextGaze) {
          targetX = reduced ? 0 : (Math.random() - .5) * 3;
          targetY = reduced ? 0 : (Math.random() - .5) * 1.5;
          nextGaze = now + 1700 + Math.random() * 3300;
        }
        const gazeEase = 1 - Math.exp(-dt / 110);
        gazeX += ((reduced ? 0 : targetX) - gazeX) * gazeEase;
        gazeY += ((reduced ? 0 : targetY) - gazeY) * gazeEase;
        const t = reduced ? 0 : now / 1000;
        const listening = !reduced && state === 'listening' ? Math.min(1, getInputLevel() * 8) : 0;
        const breath = Math.sin(t * 1.4);
        ctx.clearRect(0, 0, W, H); ctx.save();
        // Inset the artwork to preserve crown and side-lock clearance throughout motion.
        ctx.translate(512, 1080);
        ctx.rotate((reduced ? 0 : current.head * .12 + Math.sin(t * .6) * .12) * Math.PI / 180);
        ctx.scale(.965 + breath * .0015, .965 + breath * .002);
        ctx.translate(-512, -1080 - listening * 1.2);
        draw(layers.base);
        const positive = Math.min(.9, Math.max(0, (current.smile - .3) / .9));
        const negative = Math.min(.85, Math.max(0, -current.smile));
        const closed = Math.min(1, Math.max(lid, (.85 - current.eye) / .5));
        for (const eye of layers.eyes) {
          draw(eye.clean);
          // Move the intact raster eye (including its iris/highlights), never paint geometric pupils.
          const x = gazeX * (1 - closed), y = gazeY * (1 - closed);
          draw(eye.art.neutral, 1, x, y);
          draw(eye.art.happy, positive, x, y);
          draw(eye.art.sad, negative, x, y);
          draw(eye.art.closed, closed);
        }
        for (const brow of layers.brows) {
          draw(brow.neutral);
          const lift = reduced ? 0 : -current.brow * .22;
          draw(brow.happy, positive, 0, lift);
          draw(brow.sad, Math.min(1, negative + Math.max(0, current.tilt) * .035), 0, lift);
        }
        for (const tear of layers.tears) draw(tear, current.tears);
        // Opaque clean substrate removes the original lips before articulation is blended.
        const pose = mouthPose(mouth, current.smile);
        draw(layers.mouth.clean);
        draw(layers.mouth.neutral, 1 - pose.open);
        draw(layers.mouth.sad, negative * (1 - pose.open));
        draw(layers.mouth.round, pose.small);
        draw(layers.mouth.wide, pose.wide);
        if (current.blush > .01) for (const [x, y] of [[395, 455], [615, 445]] as const) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 47);
          g.addColorStop(0, blushColor); g.addColorStop(1, 'transparent');
          ctx.globalAlpha = current.blush * .2; ctx.fillStyle = g; ctx.fillRect(x - 47, y - 47, 94, 94);
        }
        const angles = hairAngles(t, mouth, reduced);
        // Front hair covers face seams; each lock rotates around its own attachment, not the image center.
        for (const part of layers.hair) {
          const [x, y] = part.definition.pivot;
          ctx.save(); ctx.translate(x, y); ctx.rotate(angles[part.definition.name]); ctx.translate(-x, -y);
          draw(part.art); ctx.restore();
        }
        ctx.restore(); ctx.globalAlpha = 1;
        el.dataset['mouthOpen'] = String(mouth); el.dataset['emotion'] = key;
        el.dataset['interruptedAt'] = String(interruptedAt);
        el.dataset['blink'] = String(closed); el.dataset['gazeX'] = String(gazeX);
        el.dataset['hairLeft'] = String(angles.left);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { disposed = true; cancelAnimationFrame(raf); };
  }, []);
  return <canvas ref={canvas} width={W} height={H} className="mahiru-avatar" role="img" aria-label="Mahiru" />;
}
