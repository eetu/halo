import { useTheme } from "@emotion/react";
import { useEffect, useRef } from "react";

import { type WeatherKind, weatherSymbolToKind } from "../weather/asciiSky";

// "fall" = falling particles (rain/snow), "twinkle" = stationary shimmer
// (clear sky ambience), "field" = a scrolling fbm-noise haze rendered through a
// density ramp — borrows the ASCII-fire look, but drifts like clouds/fog.
type Motion = "fall" | "twinkle" | "field";

// Drifting-noise parameters for the "field" motion (clouds/fog).
type FieldCfg = {
  // density ramp, sparse→dense (leading space = clear sky)
  ramp: string;
  // noise units per pixel: smaller scaleX = wider blobs; scaleX < scaleY
  // stretches features horizontally (clouds/fog streak sideways)
  scaleX: number;
  scaleY: number;
  // horizontal scroll, px/sec
  drift: number;
  // noise below this is carved away to clear sky
  threshold: number;
  // smoothstep width above the threshold (soft cloud edges)
  softness: number;
  // >0 thickens toward the bottom (low-lying fog banks)
  vGradient: number;
  // backdrop sky fill — a dim sky behind lighter clouds reads as overcast
  // rather than grey-smoke-on-white
  sky: string;
};

type KindConfig = {
  glyphs: string[];
  color: string;
  alpha: number;
  fontSize: number;
  motion: Motion;
  // particles per 1000 px² of canvas (fall/twinkle)
  density: number;
  // vertical speed range, px/sec (fall)
  vy: [number, number];
  // horizontal wind slant, px/sec (fall)
  vx: [number, number];
  // horizontal sine-drift amplitude, px (fall)
  sway: number;
  field?: FieldCfg;
  flash?: boolean;
  // rain/thunder: flick a small splash where drops hit the bottom
  splash?: boolean;
  // snow: gather a layer along the bottom and puff a "thud" as flakes land
  accumulate?: boolean;
};

const MONO = 'ui-monospace, "SF Mono", "Space Grotesk", monospace';
const FPS = 24;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Fraction of the synodic month elapsed: 0/1 = new moon, 0.5 = full moon.
// Anchored to the new moon of 2000-01-06 18:14 UTC.
function moonPhase(): number {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const days = Date.now() / 86400000;
  const p = ((days - knownNew) % synodic) / synodic;
  return p < 0 ? p + 1 : p;
}

// --- value-noise field, for drifting clouds/fog ---
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 362437) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const v00 = hash2(ix, iy, seed);
  const v10 = hash2(ix + 1, iy, seed);
  const v01 = hash2(ix, iy + 1, seed);
  const v11 = hash2(ix + 1, iy + 1, seed);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

// Fractal Brownian motion — a few octaves of value noise for puffy structure.
function fbm(x: number, y: number, seed: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 37);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// precip is mm/h: 0 = none, ~6+ = heavy downpour. It scales how dense and fast
// rain/snow fall so a drizzle and a downpour read differently.
function buildConfig(
  kind: WeatherKind,
  isDark: boolean,
  precip: number,
): KindConfig {
  const rain = isDark ? "#7f93d8" : "#5fa9d6";
  const snow = isDark ? "#b4c6ec" : "#8fb6dd";
  const star = isDark ? "#a6a6a6" : "#8f8f8f";
  const sun = isDark ? "#e0953a" : "#f2a52a";

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  const rainF = Math.min(1, Math.max(0, precip) / 6);
  const snowF = Math.min(1, Math.max(0, precip) / 3);

  switch (kind) {
    case "rain":
      return {
        glyphs: ["/", "/", "|", "'"],
        color: rain,
        alpha: isDark ? 0.2 + 0.1 * rainF : 0.16 + 0.1 * rainF,
        fontSize: 13,
        motion: "fall",
        density: lerp(0.5, 1.9, rainF),
        vy: [lerp(150, 320, rainF), lerp(280, 540, rainF)],
        vx: [lerp(-50, -90, rainF), lerp(-30, -55, rainF)],
        sway: 0,
        splash: true,
      };
    case "thunder": {
      const heavy = Math.max(0.5, rainF);
      return {
        glyphs: ["/", "/", "|", "'"],
        color: rain,
        alpha: isDark ? 0.24 + 0.08 * heavy : 0.2 + 0.08 * heavy,
        fontSize: 13,
        motion: "fall",
        density: lerp(0.9, 2.1, heavy),
        vy: [lerp(220, 360, heavy), lerp(360, 580, heavy)],
        vx: [-90, -55],
        sway: 0,
        flash: true,
        splash: true,
      };
    }
    case "snow":
      return {
        glyphs: ["*", "❄", "+", "•", "·"],
        color: snow,
        alpha: isDark ? 0.4 + 0.1 * snowF : 0.36 + 0.1 * snowF,
        fontSize: 15,
        motion: "fall",
        density: lerp(0.5, 1.7, snowF),
        vy: [lerp(14, 26, snowF), lerp(40, 64, snowF)],
        vx: [-8, 8],
        sway: 18,
        accumulate: true,
      };
    case "partly-cloudy":
      return {
        glyphs: [],
        color: isDark ? "#aab8d0" : "#ffffff",
        alpha: isDark ? 0.6 : 0.75,
        fontSize: 13,
        motion: "field",
        density: 0,
        vy: [0, 0],
        vx: [0, 0],
        sway: 0,
        field: {
          ramp: " .:-=+*#",
          scaleX: 1 / 120,
          scaleY: 1 / 52,
          drift: 12,
          threshold: 0.58, // higher → smaller clouds, more blue sky peeking
          softness: 0.32,
          vGradient: 0,
          sky: isDark ? "#243246" : "#bcd6f0",
        },
      };
    case "clouds":
      return {
        glyphs: [],
        color: isDark ? "#9aa6bf" : "#ffffff",
        alpha: isDark ? 0.6 : 0.72,
        fontSize: 13,
        motion: "field",
        density: 0,
        vy: [0, 0],
        vx: [0, 0],
        sway: 0,
        field: {
          ramp: " .:-=+*#",
          scaleX: 1 / 120,
          scaleY: 1 / 52,
          drift: 11,
          threshold: 0.5,
          softness: 0.34,
          vGradient: 0,
          sky: isDark ? "#1f2530" : "#dde3ec",
        },
      };
    case "fog":
      return {
        glyphs: [],
        color: isDark ? "#8e98ad" : "#fbfcfe",
        alpha: isDark ? 0.5 : 0.6,
        fontSize: 13,
        motion: "field",
        density: 0,
        vy: [0, 0],
        vx: [0, 0],
        sway: 0,
        field: {
          ramp: " .:-=",
          scaleX: 1 / 150,
          scaleY: 1 / 28,
          drift: 6,
          threshold: 0.34,
          softness: 0.42,
          vGradient: 0.5,
          sky: isDark ? "#1d222c" : "#e4e8ef",
        },
      };
    case "clear-night":
      return {
        glyphs: [".", "·", "+", "*", "✦"],
        color: star,
        alpha: isDark ? 0.56 : 0.4,
        fontSize: 13,
        motion: "twinkle",
        density: 0.3,
        vy: [0, 0],
        vx: [0, 0],
        sway: 0,
      };
    case "clear-day":
    default:
      return {
        glyphs: ["·", "+", "˙"],
        color: sun,
        alpha: isDark ? 0.28 : 0.26,
        fontSize: 12,
        motion: "twinkle",
        density: 0.14,
        vy: [0, 0],
        vx: [0, 0],
        sway: 0,
      };
  }
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  glyph: string;
  phase: number;
  twinkleSpeed: number;
  swayPhase: number;
};

function makeParticle(cfg: KindConfig, w: number, h: number): Particle {
  return {
    x: rand(0, w),
    y: rand(0, h),
    vx: rand(cfg.vx[0], cfg.vx[1]),
    vy: rand(cfg.vy[0], cfg.vy[1]),
    glyph: pick(cfg.glyphs),
    phase: rand(0, Math.PI * 2),
    twinkleSpeed: rand(1.5, 3.5),
    swayPhase: rand(0, Math.PI * 2),
  };
}

type WeatherAsciiBackgroundProps = {
  weatherSymbol: number;
  isNight: boolean;
  // current precipitation, mm/h — scales rain/snow intensity
  precipitation?: number;
  className?: string;
};

const WeatherAsciiBackground: React.FC<WeatherAsciiBackgroundProps> = ({
  weatherSymbol,
  isNight,
  precipitation = 0,
  className,
}) => {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDark = theme.mode === "dark";
  const kind = weatherSymbolToKind(weatherSymbol, isNight);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cfg = buildConfig(kind, isDark, precipitation);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const phase = moonPhase();
    // The header/footer are transparent when this canvas is the box background,
    // so the canvas paints the card surface itself — a dim sky for clouds/fog,
    // the normal card colour otherwise.
    const baseFill = cfg.field?.sky ?? theme.colors.background.main;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];

    // Drifting-noise field grid (clouds/fog) — see FieldCfg.
    let cols = 0;
    let rows = 0;
    let cellW = 0;
    let cellH = 0;
    const seed = Math.floor(rand(0, 1000));

    // Ground contact (rain splashes / snow pile + thuds).
    type Impact = { x: number; y: number; life: number };
    const splashes: Impact[] = [];
    const thuds: Impact[] = [];
    const groundW = cfg.fontSize * 0.6; // pile column width
    const pileUnit = cfg.fontSize * 0.5; // height of one settled snow layer
    const MAX_PILE = 3;
    const MELT = 0.12; // layers/sec — keeps the snow band uneven and alive
    let pileCols = 0;
    let pile = new Float32Array(0);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${cfg.fontSize}px ${MONO}`;
      ctx.textBaseline = "middle";

      if (cfg.motion === "field") {
        cellW = cfg.fontSize * 0.6;
        cellH = cfg.fontSize;
        cols = Math.max(2, Math.ceil(width / cellW) + 1);
        rows = Math.max(2, Math.ceil(height / cellH) + 1);
      } else {
        const target = Math.round(((width * height) / 1000) * cfg.density);
        particles = Array.from({ length: target }, () =>
          makeParticle(cfg, width, height),
        );
        if (cfg.accumulate) {
          pileCols = Math.max(1, Math.ceil(width / groundW) + 1);
          pile = new Float32Array(pileCols);
        }
      }
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = 1 / FPS;

    // Thunder: a screen flash plus a jagged ASCII bolt struck on each flash.
    let flash = 0;
    let nextFlash = rand(2.5, 6);
    let bolt: { segs: { x: number; y: number }[]; life: number } | null = null;
    const strike = () => {
      const segs: { x: number; y: number }[] = [];
      let x = rand(width * 0.3, width * 0.7);
      let y = 0;
      const endY = rand(height * 0.55, height * 0.85);
      while (y < endY) {
        segs.push({ x, y });
        y += 13;
        x += rand(-13, 13);
      }
      segs.push({ x, y });
      return { segs, life: 1 };
    };

    // Clear night: an occasional shooting star with a fading tail.
    let shooting: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
    } | null = null;
    let nextShoot = rand(3, 8);

    const drawMoon = (t: number) => {
      const R = Math.min(width, height) * 0.22;
      const cx = width * 0.82;
      const cy = height * 0.34;
      const litColor = isDark ? "#dde4f5" : "#aab6d0";
      const darkColor = isDark ? "#4f4f4f" : "#c4c4c4";
      const tw = 0.85 + 0.15 * Math.sin(t * 0.8);
      for (let gy = -R; gy <= R; gy += cfg.fontSize) {
        for (let gx = -R; gx <= R; gx += cfg.fontSize * 0.6) {
          const nx = gx / R;
          const ny = gy / R;
          if (nx * nx + ny * ny > 1) continue;
          const xLimb = Math.sqrt(Math.max(0, 1 - ny * ny));
          const term = Math.cos(2 * Math.PI * phase) * xLimb;
          const lit = phase < 0.5 ? nx >= term : nx <= -term;
          if (lit) {
            const r = Math.sqrt(nx * nx + ny * ny);
            ctx.globalAlpha = cfg.alpha * tw;
            ctx.fillStyle = litColor;
            ctx.fillText(r < 0.55 ? "@" : "o", cx + gx, cy + gy);
          } else {
            ctx.globalAlpha = cfg.alpha * 0.12;
            ctx.fillStyle = darkColor;
            ctx.fillText("·", cx + gx, cy + gy);
          }
        }
      }
    };

    const drawSun = (t: number) => {
      const horizonY = height * 0.8;
      const cx = width * 0.5;
      const R = Math.min(width, height) * 0.3;
      const cy = horizonY - R * 0.5 + Math.sin(t * 0.18) * 6; // rising/setting
      const cw = cfg.fontSize * 0.6;
      const ramp = " .:-=+*#@";
      ctx.fillStyle = cfg.color;

      // corona — flickering noise-driven rays, rotating slowly above horizon
      const rot = t * 0.08;
      const rays = 30;
      for (let k = 0; k < rays; k++) {
        const a = rot + (k / rays) * Math.PI * 2;
        const len = R * 0.55 * (0.35 + fbm(k * 0.6, t * 0.5, seed) * 1.3);
        for (let rr = R + 3; rr <= R + len; rr += cfg.fontSize * 0.75) {
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          if (py > horizonY) continue;
          ctx.globalAlpha = cfg.alpha * 0.9 * (1 - (rr - R) / (len + 6));
          ctx.fillText(rr - R < len * 0.5 ? "*" : "·", px, py);
        }
      }

      // churning solar surface — fbm granulation × radial falloff, ramp-mapped
      for (let gy = -R; gy <= R; gy += cfg.fontSize) {
        for (let gx = -R; gx <= R; gx += cw) {
          const r = Math.sqrt(gx * gx + gy * gy) / R;
          if (r > 1 || cy + gy > horizonY) continue;
          const granule = fbm(gx * 0.05 + t * 0.4, gy * 0.05 - t * 0.1, seed);
          let v = (1 - r) * 0.95 + (granule - 0.5) * 0.6;
          if (v <= 0) continue;
          if (v > 1) v = 1;
          const g =
            ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
          if (g === " ") continue;
          ctx.globalAlpha = cfg.alpha * (0.5 + v * 0.5);
          ctx.fillText(g, cx + gx, cy + gy);
        }
      }

      // shimmering horizon line
      ctx.globalAlpha = cfg.alpha * (0.45 + 0.3 * Math.sin(t * 2));
      for (let x = 0; x < width; x += cw) {
        ctx.fillText(Math.sin(x * 0.05 + t * 2) > 0 ? "~" : "-", x, horizonY);
      }
    };

    const draw = (dt: number) => {
      ctx.globalAlpha = 1;
      ctx.fillStyle = baseFill;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${cfg.fontSize}px ${MONO}`;
      const t = last / 1000;

      if (cfg.motion === "field" && cfg.field) {
        const f = cfg.field;
        const ramp = f.ramp;
        const ox = t * f.drift; // clouds scroll sideways
        const oy = Math.sin(t * 0.08) * 16; // gentle vertical breathing
        ctx.fillStyle = cfg.color;
        for (let y = 0; y < rows; y++) {
          const py = y * cellH;
          const grad = f.vGradient * (y / rows);
          for (let x = 0; x < cols; x++) {
            const px = x * cellW;
            const n = fbm((px + ox) * f.scaleX, (py + oy) * f.scaleY, seed);
            let v = (n + grad - f.threshold) / f.softness;
            if (v <= 0) continue;
            if (v > 1) v = 1;
            const idx = Math.min(ramp.length - 1, Math.floor(v * ramp.length));
            const g = ramp[idx];
            if (g === " ") continue;
            ctx.globalAlpha = cfg.alpha * v;
            ctx.fillText(g, px, py + cellH / 2);
          }
        }
      } else {
        ctx.fillStyle = cfg.color;
        for (const p of particles) {
          if (cfg.motion === "fall") {
            p.y += p.vy * dt;
            p.x += p.vx * dt;
            if (cfg.sway > 0) {
              p.x += Math.sin(t * 0.8 + p.swayPhase) * cfg.sway * dt;
            }
            // ground contact: snow settles into a pile, rain splashes
            let landed = false;
            if (cfg.accumulate && pileCols > 0) {
              const col = Math.min(
                pileCols - 1,
                Math.max(0, Math.floor(p.x / groundW)),
              );
              const landingY = height - pile[col] * pileUnit;
              if (p.y >= landingY) {
                if (pile[col] < MAX_PILE) pile[col] += 1;
                if (thuds.length < 50) {
                  thuds.push({ x: p.x, y: landingY, life: 1 });
                }
                landed = true;
              }
            } else if (cfg.splash && p.y >= height) {
              if (splashes.length < 60) {
                splashes.push({ x: p.x, y: height, life: 1 });
              }
              landed = true;
            }
            if (landed || p.y > height + cfg.fontSize) {
              p.y = -cfg.fontSize;
              p.x = rand(0, width);
              p.glyph = pick(cfg.glyphs);
            }
            if (p.x < -cfg.fontSize) p.x = width + cfg.fontSize;
            if (p.x > width + cfg.fontSize) p.x = -cfg.fontSize;
            ctx.globalAlpha = cfg.alpha;
          } else {
            const tw =
              0.35 + 0.65 * Math.abs(Math.sin(t * p.twinkleSpeed + p.phase));
            ctx.globalAlpha = cfg.alpha * tw;
          }
          ctx.fillText(p.glyph, p.x, p.y);
        }

        // Settled snow layer + soft "thud" puffs as flakes land.
        if (cfg.accumulate && pileCols > 0) {
          ctx.fillStyle = cfg.color;
          for (let c = 0; c < pileCols; c++) {
            const stacks = Math.floor(pile[c]);
            for (let k = 0; k < stacks; k++) {
              ctx.globalAlpha = cfg.alpha * 0.9;
              ctx.fillText(
                "*",
                c * groundW,
                height - k * pileUnit - pileUnit / 2,
              );
            }
            pile[c] = Math.max(0, pile[c] - MELT * dt);
          }
          for (let i = thuds.length - 1; i >= 0; i--) {
            const th = thuds[i];
            const spread = (1 - th.life) * 4;
            ctx.globalAlpha = cfg.alpha * th.life * 0.7;
            ctx.fillText("·", th.x - spread, th.y);
            ctx.fillText("·", th.x + spread, th.y);
            th.life -= dt * 2.5;
            if (th.life <= 0) thuds.splice(i, 1);
          }
        }

        // Rain splashes — two droplets flicking up and out from impact.
        if (cfg.splash) {
          ctx.fillStyle = cfg.color;
          for (let i = splashes.length - 1; i >= 0; i--) {
            const s = splashes[i];
            const spread = (1 - s.life) * 5;
            const rise = Math.sin((1 - s.life) * Math.PI) * 5;
            ctx.globalAlpha = cfg.alpha * s.life;
            ctx.fillText("·", s.x - spread, s.y - rise - 3);
            ctx.fillText("·", s.x + spread, s.y - rise - 3);
            s.life -= dt * 3.5;
            if (s.life <= 0) splashes.splice(i, 1);
          }
        }
      }

      if (kind === "clear-day") drawSun(t);

      if (kind === "clear-night") {
        drawMoon(t);
        nextShoot -= dt;
        if (nextShoot <= 0 && !shooting) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          shooting = {
            x: dir > 0 ? rand(0, width * 0.4) : rand(width * 0.6, width),
            y: rand(0, height * 0.4),
            vx: dir * rand(150, 230),
            vy: rand(50, 100),
            life: 1,
          };
          nextShoot = rand(4, 10);
        }
        if (shooting) {
          shooting.x += shooting.vx * dt;
          shooting.y += shooting.vy * dt;
          shooting.life -= dt * 0.9;
          ctx.fillStyle = isDark ? "#e6ecff" : "#8aa0d8";
          for (let i = 0; i < 7; i++) {
            const tx = shooting.x - shooting.vx * 0.03 * i;
            const ty = shooting.y - shooting.vy * 0.03 * i;
            ctx.globalAlpha = Math.max(0, shooting.life) * (1 - i / 7);
            ctx.fillText(i === 0 ? "✦" : i < 3 ? "—" : "·", tx, ty);
          }
          if (
            shooting.life <= 0 ||
            shooting.x < -20 ||
            shooting.x > width + 20
          ) {
            shooting = null;
          }
        }
      }

      if (cfg.flash) {
        nextFlash -= dt;
        if (nextFlash <= 0 && flash <= 0) {
          flash = 1;
          bolt = strike();
          nextFlash = rand(3, 8);
        }
        if (flash > 0) {
          ctx.globalAlpha = flash * (isDark ? 0.16 : 0.1);
          ctx.fillStyle = isDark ? "#cdd6ff" : "#9fb0ff";
          ctx.fillRect(0, 0, width, height);
          flash -= dt * 3;
        }
        if (bolt) {
          ctx.fillStyle = isDark ? "#ffe24a" : "#f5c211";
          ctx.font = `bold ${cfg.fontSize + 4}px ${MONO}`;
          for (let i = 0; i < bolt.segs.length - 1; i++) {
            const dx = bolt.segs[i + 1].x - bolt.segs[i].x;
            const g = dx > 4 ? "\\" : dx < -4 ? "/" : "|";
            ctx.globalAlpha = Math.max(0, bolt.life);
            ctx.fillText(g, bolt.segs[i].x, bolt.segs[i].y);
          }
          ctx.font = `${cfg.fontSize}px ${MONO}`;
          bolt.life -= dt * 2.2;
          if (bolt.life <= 0) bolt = null;
        }
      }

      ctx.globalAlpha = 1;
    };

    resize();

    if (reduceMotion) {
      draw(0);
      const ro = new ResizeObserver(() => {
        resize();
        draw(0);
      });
      ro.observe(parent);
      return () => ro.disconnect();
    }

    const loop = (nowTs: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (nowTs - last) / 1000);
      acc += dt;
      if (acc < frame) return;
      last = nowTs;
      draw(acc);
      acc = 0;
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [kind, isDark, precipitation, theme.colors.background.main]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      css={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
};

export default WeatherAsciiBackground;
