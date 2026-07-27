import "leaflet/dist/leaflet.css";

import { useTheme } from "@emotion/react";
import { format } from "date-fns";
import * as L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { api, jsonFetcher } from "../api";
import useLocationSettings from "../hooks/useLocationSettings";
import { mq } from "../mq";
import Icon from "./Icon";

type RadarFrames = {
  layer: string;
  times: string[];
  intervalMinutes: number;
};

type ForecastFrame = { time: string; max: number; values: number[] };
type PrecipForecast = {
  bbox: [number, number, number, number]; // [south, west, north, east]
  cols: number;
  rows: number;
  unit: string;
  frames: ForecastFrame[];
};

type Frame = {
  kind: "observed" | "forecast";
  time: string;
  layer: L.TileLayer.WMS | L.ImageOverlay;
  baseOpacity: number;
};

const FRAME_COUNT = 12; // observed radar frames (5-min steps → last hour)
const FORECAST_HOURS = 12; // forecast frames (hourly)
const DEFAULT_ZOOM = 8;
// One opacity for both halves of the timeline: the observed tiles now carry the
// same ramp and the same per-pixel alpha as the forecast canvas, so anything else
// would make the palette jump as you scrub past "now".
const OVERLAY_OPACITY = 0.6;
const PRECIP_ALPHA = 185; // 0–255, applied by both the canvas and the WMS SLD
const PLAY_MS = 450; // per-frame while playing
const HOLD_MS = 1100; // linger on the last frame before looping
const LONG_PRESS_MS = 300; // hold before map-swipe scrubbing engages
const PAN_THRESHOLD = 10; // px of movement that counts as a pan, not a press
const PX_PER_FRAME = 26; // swipe sensitivity once scrubbing

// Precipitation colour ramp (mm/h → RGB). Shared by the heat overlay and legend.
// Thresholds are tuned to Finnish rain rates — the bulk of what FMI forecasts is
// 0.1–5 mm/h, so the ramp has to resolve that band rather than spend its blues on
// it; heavier rates are rare enough to compress into the top stops.
const PRECIP_STOPS: { v: number; c: [number, number, number] }[] = [
  { v: 0.1, c: [150, 210, 255] },
  { v: 0.3, c: [90, 170, 245] },
  { v: 0.6, c: [50, 120, 230] },
  { v: 1, c: [40, 80, 200] },
  { v: 2, c: [60, 180, 90] },
  { v: 4, c: [220, 205, 50] },
  { v: 8, c: [240, 140, 30] },
  { v: 15, c: [225, 45, 45] },
  { v: 30, c: [170, 0, 110] },
];

const precipColor = (v: number): [number, number, number, number] => {
  if (!(v >= PRECIP_STOPS[0].v)) return [0, 0, 0, 0];
  let c = PRECIP_STOPS[0].c;
  for (const s of PRECIP_STOPS) if (v >= s.v) c = s.c;
  return [c[0], c[1], c[2], PRECIP_ALPHA];
};

const hex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

/**
 * FMI's WMS colours the observed radar server-side, so the only way to get halo's
 * ramp onto those frames is to hand GeoServer our own colour map — otherwise the
 * timeline switches palettes at "now" and the legend describes only half of it.
 *
 * The `rr` layer's band is mm/h × 100, matching the forecast overlay's unit.
 * `type="intervals"` reads each quantity as that interval's *upper* bound, so
 * entry N carries stop N−1's colour: a leading transparent entry cuts everything
 * below the first stop, and a wide-open final entry catches the extremes.
 */
const buildRadarSld = (layer: string) => {
  const band = (mm: number) => Math.round(mm * 100);
  const alpha = (PRECIP_ALPHA / 255).toFixed(3);
  const entries = [
    `<ColorMapEntry color="#000000" opacity="0" quantity="${band(PRECIP_STOPS[0].v)}"/>`,
    ...PRECIP_STOPS.map((s, i) => {
      const upper = PRECIP_STOPS[i + 1]?.v ?? s.v * 1000;
      return `<ColorMapEntry color="${hex(s.c)}" opacity="${alpha}" quantity="${band(upper)}"/>`;
    }),
  ].join("");
  return `<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" version="1.0.0"><NamedLayer><Name>${layer}</Name><UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer><ColorMap type="intervals">${entries}</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
};

// Web Mercator's y for a latitude, in the projection's natural units — only the
// ratio between two y values is used below, so the scale factor cancels out.
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y: number) => ((Math.atan(Math.exp(y)) * 2 - Math.PI / 2) * 180) / Math.PI;

/**
 * Paint one forecast grid into a canvas and wrap it as a geo-placed overlay.
 *
 * `L.imageOverlay` stretches the image linearly in Web Mercator, but the grid is
 * regular in *latitude* — so the rows are resampled into Mercator space here.
 * Skipping that lands the field a few km too far north mid-box (≈2.6 km over the
 * current bbox, about one grid cell). Columns stay 1:1: longitude is linear in
 * Mercator.
 */
const buildForecastOverlay = (fc: PrecipForecast, frame: ForecastFrame): L.ImageOverlay => {
  const { cols, rows, bbox } = fc;
  const [south, west, north, east] = bbox;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(cols, rows);
  const lastRow = Math.max(1, rows - 1);
  const yNorth = mercY(north);
  const ySouth = mercY(south);
  const dLat = (north - south) / lastRow;
  for (let y = 0; y < rows; y++) {
    const lat = invMercY(yNorth + (ySouth - yNorth) * (y / lastRow));
    const src = Math.min(rows - 1, Math.max(0, Math.round((north - lat) / dLat)));
    for (let x = 0; x < cols; x++) {
      const [r, g, b, a] = precipColor(frame.values[src * cols + x]);
      const o = (y * cols + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return L.imageOverlay(
    canvas.toDataURL(),
    [
      [south, west],
      [north, east],
    ],
    { opacity: 0, interactive: false },
  );
};

const RainMap = ({ className }: { className?: string }) => {
  const theme = useTheme();
  const { location } = useLocationSettings();

  const {
    data: obsData,
    error: obsError,
    mutate: mutateObs,
  } = useSWR<RadarFrames>(api(`/api/radar/frames?count=${FRAME_COUNT}`), jsonFetcher, {
    refreshInterval: 60_000,
    shouldRetryOnError: false,
  });
  const {
    data: fcData,
    error: fcError,
    mutate: mutateFc,
  } = useSWR<PrecipForecast>(
    location
      ? api(`/api/radar/forecast?lat=${location.lat}&lon=${location.lon}&hours=${FORECAST_HOURS}`)
      : null,
    jsonFetcher,
    // The FMI GRIB fetch can fail transiently (502); retry a few times rather
    // than leaving the timeline stuck at "now" until the next refresh.
    { refreshInterval: 600_000, errorRetryCount: 4, errorRetryInterval: 5_000 },
  );

  // Cutoff for "still ahead of us". Bumped on wake rather than ticked on a
  // clock: a per-second tick would rebuild the whole Leaflet layer stack.
  const [horizon, setHorizon] = useState(() => Date.now());

  // iOS suspends `refreshInterval` timers while backgrounded, so a phone or
  // panel picked up after a long sleep still holds whatever it had when it went
  // under. Refetch on wake — same pattern and reason as SpotPrice.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setHorizon(Date.now());
      void mutateObs();
      void mutateFc();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mutateObs, mutateFc]);

  // Forecast frames carry absolute valid times, so the copy held in memory ages
  // as the device sleeps. Drop what has already happened, so the timeline can't
  // label an elapsed frame "+1 h" in the gap between waking and the refetch
  // landing. The backend trims the same way on every response; this is the
  // client-side half of it.
  const forecastFrames = useMemo(
    () => (fcData?.frames ?? []).filter((f) => new Date(f.time).getTime() > horizon),
    [fcData, horizon],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const framesRef = useRef<Frame[]>([]);
  const [ready, setReady] = useState(false);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  // Frame metadata (kind + time), derived so labels/slider re-render in step
  // with the layers built in the effect below from the same two sources.
  const timeline = useMemo(() => {
    const obs = (obsData?.times ?? []).map((time) => ({ kind: "observed", time }) as const);
    const fc = forecastFrames.map((f) => ({ kind: "forecast", time: f.time }) as const);
    return [...obs, ...fc];
  }, [obsData, forecastFrames]);

  const observedCount = obsData?.times.length ?? 0;
  const nowIndex = observedCount - 1;
  const nowTime = obsData?.times[nowIndex];
  const lastIndex = timeline.length - 1;

  // --- map lifecycle (re-created if the location changes) ---
  useEffect(() => {
    if (!location || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [location.lat, location.lon],
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });
    map.attributionControl.addAttribution(
      'Sää © <a href="https://en.ilmatieteenlaitos.fi/open-data">FMI</a>',
    );
    mapRef.current = map;
    // Leaflet mis-sizes if the container grew after init; defer sizing and the
    // readiness signal so dependent effects see a correctly-sized map.
    const sizeTimer = setTimeout(() => {
      map.invalidateSize();
      setReady(true);
    }, 0);
    return () => {
      clearTimeout(sizeTimer);
      map.remove();
      mapRef.current = null;
      baseRef.current = null;
      framesRef.current = [];
      setReady(false);
    };
  }, [location]);

  // --- base map, swapped with the colour scheme ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (baseRef.current) map.removeLayer(baseRef.current);
    const variant = theme.mode === "dark" ? "dark_all" : "light_all";
    const base = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`, {
      subdomains: "abcd",
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    });
    base.addTo(map);
    base.bringToBack();
    baseRef.current = base;
  }, [theme.mode, ready]);

  // --- saved-location marker, so the centre point stays findable under the
  // overlay. Accent orange: the precipitation ramp is all blues/greens/reds, so
  // the marker can't be mistaken for rain. Vector layers default into
  // `overlayPane` alongside the forecast images — `markerPane` keeps it on top
  // (Leaflet spins up a per-pane renderer for a non-default `pane`).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !location) return;
    const at: L.LatLngExpression = [location.lat, location.lon];
    const accent = theme.colors.activity.on;
    const marks = [
      L.circleMarker(at, {
        pane: "markerPane",
        radius: 9,
        color: accent,
        weight: 2,
        fill: false,
        interactive: false,
      }),
      L.circleMarker(at, {
        pane: "markerPane",
        radius: 3.5,
        color: theme.colors.background.main,
        weight: 1.5,
        fillColor: accent,
        fillOpacity: 1,
        interactive: false,
      }),
    ];
    marks.forEach((m) => m.addTo(map));
    return () => marks.forEach((m) => map.removeLayer(m));
  }, [location, ready, theme.colors.activity.on, theme.colors.background.main]);

  // --- build the unified layer stack: observed WMS tiles + forecast heat ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    framesRef.current.forEach((f) => map.removeLayer(f.layer));

    const built: Frame[] = [];
    if (obsData) {
      // Same colour map for all 12 frames, so build it once.
      const sldBody = buildRadarSld(obsData.layer);
      for (const time of obsData.times) {
        const layer = L.tileLayer
          .wms(api("/api/radar/wms"), {
            layers: obsData.layer,
            format: "image/png",
            transparent: true,
            version: "1.3.0",
            opacity: 0,
            time,
            sld_body: sldBody,
          } as unknown as L.WMSOptions)
          .addTo(map);
        built.push({
          kind: "observed",
          time,
          layer,
          baseOpacity: OVERLAY_OPACITY,
        });
      }
    }
    if (fcData && forecastFrames.length > 0) {
      for (const frame of forecastFrames) {
        const layer = buildForecastOverlay(fcData, frame).addTo(map);
        built.push({
          kind: "forecast",
          time: frame.time,
          layer,
          baseOpacity: OVERLAY_OPACITY,
        });
      }
    }
    framesRef.current = built;

    // Show "now" (last observed frame) immediately to avoid a blank flash,
    // then sync the index to it on the next tick.
    const startIdx = Math.max(0, (obsData?.times.length ?? 0) - 1);
    built[startIdx]?.layer.setOpacity(built[startIdx].baseOpacity);
    const indexTimer = setTimeout(() => setIndex(startIdx), 0);
    return () => {
      clearTimeout(indexTimer);
      built.forEach((f) => map.removeLayer(f.layer));
      framesRef.current = [];
    };
  }, [obsData, fcData, forecastFrames, ready]);

  // --- show only the active frame ---
  useEffect(() => {
    framesRef.current.forEach((f, i) => f.layer.setOpacity(i === index ? f.baseOpacity : 0));
  }, [index, timeline]);

  // --- playback loop ---
  useEffect(() => {
    if (!playing || timeline.length === 0) return;
    const delay = index >= lastIndex ? HOLD_MS : PLAY_MS;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % timeline.length), delay);
    return () => clearTimeout(timer);
  }, [playing, index, lastIndex, timeline.length]);

  const scrubTo = useCallback((i: number) => {
    const len = framesRef.current.length;
    if (len === 0) return;
    setIndex(Math.max(0, Math.min(len - 1, i)));
  }, []);

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (map && location)
      map.setView([location.lat, location.lon], DEFAULT_ZOOM, {
        animate: true,
      });
  }, [location]);

  // --- long-press-then-swipe on the map to scrub frame by frame ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const el = map.getContainer();

    let timer: ReturnType<typeof setTimeout> | null = null;
    let engaged = false;
    let startX = 0;
    let baseIndex = 0;

    const cancelTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const release = () => {
      cancelTimer();
      if (engaged) {
        engaged = false;
        map.dragging.enable();
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX;
      cancelTimer();
      timer = setTimeout(() => {
        engaged = true;
        timer = null;
        baseIndex = index;
        startX = e.clientX;
        map.dragging.disable();
        setPlaying(false);
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (engaged) {
        const steps = Math.round((e.clientX - startX) / PX_PER_FRAME);
        scrubTo(baseIndex + steps);
      } else if (Math.abs(e.clientX - startX) > PAN_THRESHOLD) {
        // a real pan — let Leaflet have it
        cancelTimer();
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);
    return () => {
      release();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("pointerleave", release);
    };
  }, [ready, index, scrubTo]);

  const active = timeline[index];
  const obsInterval = obsData?.intervalMinutes ?? 5;
  let relText = "";
  let relColor = theme.colors.text.muted;
  if (active?.kind === "observed") {
    const back = nowIndex - index;
    if (back <= 0) {
      relText = "nyt";
      relColor = theme.colors.activity.on;
    } else {
      relText = `−${back * obsInterval} min`;
    }
  } else if (active?.kind === "forecast") {
    // Measured from the frame's own valid time against the latest observed
    // frame — the same instant the timeline calls "nyt" — rather than from its
    // position in the array. A cached grid can have lost its leading hours, and
    // an index-derived label would then quietly misdate every frame.
    //
    // Ceil, not round: "nyt" lands wherever the last radar sweep did (:50, say)
    // while forecast frames sit on the hour, so the first one is only minutes
    // out. Rounding would call both 10:00 and 11:00 "+1 h"; ceil counts whole
    // forecast hours, which is what the label means.
    const ahead = nowTime
      ? Math.ceil((new Date(active.time).getTime() - new Date(nowTime).getTime()) / 3_600_000)
      : index - nowIndex;
    relText = `+${Math.max(1, ahead)} h`;
    relColor = theme.colors.cool;
  }
  const activeForecastDry =
    active?.kind === "forecast" && (forecastFrames[index - observedCount]?.max ?? 0) === 0;

  const legendGradient = PRECIP_STOPS.map(
    (s, i) => `rgb(${s.c[0]},${s.c[1]},${s.c[2]}) ${(i / (PRECIP_STOPS.length - 1)) * 100}%`,
  ).join(", ");

  const overlayPanel = theme.mode === "dark" ? "rgba(37,37,37,0.9)" : "rgba(255,255,255,0.9)";

  if (!location) {
    return (
      <div
        className={className}
        css={{
          backgroundColor: theme.colors.background.main,
          boxShadow: theme.shadows.main,
          borderRadius: theme.border.radius,
          padding: "2em",
          textAlign: "center",
          color: theme.colors.text.muted,
          ...theme.typography.body2,
        }}
      >
        Aseta sijainti asetuksista nähdäksesi sadetutkan.
      </div>
    );
  }

  return (
    <div
      className={className}
      css={{
        position: "relative",
        borderRadius: theme.border.radius,
        overflow: "hidden",
        boxShadow: theme.shadows.main,
        height: "72vh",
        minHeight: 420,
        [mq[0]]: { height: "70vh", minHeight: 360 },
      }}
    >
      <div ref={containerRef} css={{ position: "absolute", inset: 0, zIndex: 0 }} />

      {/* precipitation legend (top-centre, clear of the left zoom + right recenter).
          Both halves of the timeline are mm/h in this ramp, so it stays valid
          whichever half has loaded. */}
      {(obsData || fcData) && (
        <div
          css={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            padding: "6px 8px",
            borderRadius: theme.border.radius,
            backgroundColor: overlayPanel,
            boxShadow: theme.shadows.main,
            color: theme.colors.text.muted,
          }}
        >
          <div
            css={{
              width: 132,
              height: 7,
              borderRadius: 4,
              background: `linear-gradient(to right, ${legendGradient})`,
            }}
          />
          <div
            css={{
              display: "flex",
              justifyContent: "space-between",
              ...theme.typography.caption,
              fontSize: 11,
              marginTop: 2,
            }}
          >
            <span>kevyt</span>
            <span>sade</span>
            <span>rankka</span>
          </div>
        </div>
      )}

      {/* recenter to the saved location */}
      <button
        onClick={recenter}
        aria-label="Keskitä sijaintiin"
        css={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 1000,
          display: "flex",
          padding: 8,
          cursor: "pointer",
          border: "none",
          borderRadius: theme.border.radius,
          color: theme.colors.text.main,
          backgroundColor: overlayPanel,
          boxShadow: theme.shadows.main,
        }}
      >
        <Icon size={22}>my_location</Icon>
      </button>

      {/* "no rain forecast" hint keeps a blank forecast frame from looking broken */}
      {activeForecastDry && (
        <div
          css={{
            position: "absolute",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            padding: "4px 10px",
            borderRadius: theme.border.radius,
            backgroundColor: overlayPanel,
            ...theme.typography.caption,
            color: theme.colors.text.muted,
          }}
        >
          ei sadetta ennusteessa
        </div>
      )}

      {/* control bar */}
      <div
        css={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 16px",
          background:
            theme.mode === "dark"
              ? "linear-gradient(to top, rgba(15,15,15,0.85), rgba(15,15,15,0))"
              : "linear-gradient(to top, rgba(255,255,255,0.9), rgba(255,255,255,0))",
          color: theme.colors.text.main,
        }}
      >
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pysäytä" : "Toista"}
          css={{
            cursor: "pointer",
            border: "none",
            background: "transparent",
            color: theme.colors.activity.on,
            display: "flex",
            padding: 4,
          }}
        >
          <Icon size={30}>{playing ? "pause_circle" : "play_circle"}</Icon>
        </button>

        <div
          css={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <input
            type="range"
            min={0}
            max={Math.max(0, lastIndex)}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              scrubTo(Number(e.target.value));
            }}
            css={{
              width: "100%",
              accentColor: theme.colors.activity.on,
              cursor: "pointer",
            }}
          />
          {/* "now" divider between observed and forecast */}
          {observedCount > 0 && observedCount <= lastIndex && (
            <div
              css={{
                position: "absolute",
                left: `${(nowIndex / lastIndex) * 100}%`,
                top: -2,
                bottom: -2,
                width: 2,
                transform: "translateX(-1px)",
                backgroundColor: theme.colors.text.main,
                opacity: 0.45,
                pointerEvents: "none",
              }}
            />
          )}
        </div>

        <div
          css={{
            flexShrink: 0,
            textAlign: "right",
            minWidth: 70,
            lineHeight: 1.1,
          }}
        >
          <div
            css={{
              ...theme.typography.label,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {active ? format(new Date(active.time), "HH:mm") : "––:––"}
          </div>
          <div css={{ ...theme.typography.caption, color: relColor }}>{relText}</div>
        </div>
      </div>

      {obsError && fcError && !obsData && !fcData && (
        <div
          css={{
            position: "absolute",
            top: 12,
            left: 0,
            right: 0,
            zIndex: 1000,
            textAlign: "center",
            ...theme.typography.caption,
            color: theme.colors.text.muted,
          }}
        >
          Sadetutka ei juuri nyt saatavilla
        </div>
      )}
    </div>
  );
};

export default RainMap;
