import { css, useTheme } from "@emotion/react";
import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import CurrentTime from "./components/CurrentTime";
import EnergyDailyHistory from "./components/Energy/DailyHistory";
import EnergyFlow from "./components/Energy/Flow";
import EnergyReserve from "./components/Energy/Reserve";
import EnergySpotPrice from "./components/Energy/SpotPrice";
import EnergySummary from "./components/Energy/Summary";
import FmiWeatherBox from "./components/FmiWeatherBox";
import History from "./components/History";
import Icon from "./components/Icon";
import LightGroups from "./components/LightGroups";
import LocationForm from "./components/LocationForm";
import Motion from "./components/Motion";
import SolisBox from "./components/SolisBox";
import TemperatureBox from "./components/TemperatureBox";
import Wordmark from "./components/Wordmark";
import { mq } from "./mq";
import { type HueLiveEvent, type Response, type Sensor } from "./types/hue";

const applyEvent = (data: Response, event: HueLiveEvent): Response => {
  switch (event.type) {
    case "grouped_light":
      return {
        ...data,
        groups: data.groups.map((g) =>
          g.id === event.id
            ? {
                ...g,
                state: {
                  on: event.on ?? g.state.on,
                  brightness: event.brightness ?? g.state.brightness,
                },
              }
            : g,
        ),
      };
    case "temperature":
      return {
        ...data,
        sensors: data.sensors.map((s) =>
          s.id === event.id ? { ...s, temperature: event.temperature } : s,
        ),
      };
    case "device_power":
      return {
        ...data,
        sensors: data.sensors.map((s) =>
          s.deviceId === event.deviceId ? { ...s, battery: event.battery } : s,
        ),
      };
    case "motion":
      return {
        ...data,
        sensors: data.sensors.map((s) =>
          s.deviceId === event.deviceId
            ? { ...s, motion: event.motion, motionUpdatedAt: event.updatedAt }
            : s,
        ),
      };
    case "motion_enabled":
      return {
        ...data,
        sensors: data.sensors.map((s) =>
          s.deviceId === event.deviceId
            ? { ...s, motionEnabled: event.enabled }
            : s,
        ),
      };
    case "connectivity":
      return {
        ...data,
        sensors: data.sensors.map((s) =>
          s.deviceId === event.deviceId
            ? { ...s, connected: event.connected }
            : s,
        ),
      };
  }
};

type View =
  | "temperature"
  | "energy"
  | "lights"
  | "motion"
  | "history"
  | "settings";

const VIEWS: { id: View; icon: string }[] = [
  { id: "temperature", icon: "thermostat" },
  { id: "energy", icon: "bolt" },
  { id: "lights", icon: "lightbulb" },
  { id: "motion", icon: "directions_run" },
  { id: "history", icon: "timeline" },
  { id: "settings", icon: "settings" },
];

const App = () => {
  const [data, setData] = useState<Response | undefined>(undefined);
  const [error, setError] = useState(false);
  const [view, setView] = useState<View>("temperature");
  const [fullscreen, setFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const syncData = () => {
      fetch(api("/api/hue"))
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d: Response) => {
          setData(d);
          setError(false);
        })
        .catch(() => setError(true));
    };

    syncData();
    const es = new EventSource(api("/api/hue/events"));
    es.onopen = syncData;
    es.onerror = () => setError(true);
    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as HueLiveEvent;
      setData((prev) => (prev ? applyEvent(prev, event) : prev));
    };
    return () => es.close();
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  const temperatureCss = css({ gridRow: 2 });

  const sensors = data?.sensors;
  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);

  const { inside, outside, insideCold } = useMemo(() => {
    const empty: Sensor[] = [];
    if (!sensors) return { inside: empty, outside: empty, insideCold: empty };
    return sensors.reduce(
      (acc, s) => {
        if (s.type === "inside_cold") acc.insideCold = acc.insideCold.concat(s);
        else acc[s.type] = acc[s.type].concat(s);
        return acc;
      },
      { inside: empty, outside: empty, insideCold: empty },
    );
  }, [sensors]);

  const outsideTemp = Math.min(
    ...outside
      .map((s) => s.temperature)
      .filter((t): t is number => t !== undefined),
  );

  const theme = useTheme();

  return (
    <>
      <Wordmark
        css={{
          position: "absolute",
          top: 14,
          left: 18,
        }}
      />
      <button
        css={{
          position: "absolute",
          top: "8px",
          right: "8px",
          cursor: "pointer",
          backgroundColor: "transparent",
          border: "none",
          color: theme.colors.text.muted,
        }}
        onClick={toggleFullscreen}
      >
        <Icon size={20}>{!fullscreen ? "fullscreen" : "fullscreen_exit"}</Icon>
      </button>
      <div
        css={{
          width: 800,
          flexShrink: 0,
          padding: "16px 0",
          [mq[0]]: {
            width: "100%",
            flexShrink: 1,
            padding: "12px",
            boxSizing: "border-box",
          },
        }}
      >
        <CurrentTime
          css={{
            [mq[0]]: { fontSize: "12px" },
          }}
        />
        <div
          css={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            width: "100%",
            marginTop: "1em",
            [mq[0]]: { flexDirection: "column" },
          }}
        >
          <div
            css={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              width: 48,
              flexShrink: 0,
              paddingTop: "0.5em",
              [mq[0]]: {
                flexDirection: "row",
                width: "auto",
                paddingTop: 0,
                paddingBottom: "0.25em",
              },
            }}
          >
            {VIEWS.map(({ id, icon }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  css={{
                    position: "relative",
                    cursor: "pointer",
                    backgroundColor: "transparent",
                    border: "none",
                    color: active
                      ? theme.colors.activity.on
                      : theme.colors.text.muted,
                    padding: "6px",
                    transition: "color 0.15s ease",
                  }}
                >
                  <Icon size={26}>{icon}</Icon>
                  {active && (
                    <span
                      css={{
                        position: "absolute",
                        left: -2,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 3,
                        height: 18,
                        borderRadius: 2,
                        backgroundColor: theme.colors.activity.on,
                        [mq[0]]: {
                          left: "50%",
                          top: "auto",
                          bottom: -2,
                          transform: "translateX(-50%)",
                          width: 18,
                          height: 3,
                        },
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div
            css={{
              flex: 1,
              minWidth: 0,
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              alignItems: "start",
              gap: 20,
              [mq[0]]: {
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                width: "100%",
              },
            }}
          >
            {view === "temperature" && (
              <>
                <FmiWeatherBox css={{ gridColumn: "1 / span 4", gridRow: 1 }} />
                <TemperatureBox
                  css={temperatureCss}
                  sensors={outside}
                  title="ulkona"
                  error={error}
                  temperatureOverride={outsideTemp}
                />
                <TemperatureBox
                  css={temperatureCss}
                  sensors={inside}
                  title="sisällä"
                  error={error}
                />
                <TemperatureBox
                  css={temperatureCss}
                  sensors={insideCold}
                  title="kuisti"
                  error={error}
                />
                <SolisBox css={temperatureCss} />
              </>
            )}

            {view === "energy" && (
              <div
                css={{
                  gridColumn: "1 / span 4",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <EnergySpotPrice />
                <EnergyFlow />
                <EnergySummary />
                <EnergyDailyHistory />
                <EnergyReserve />
              </div>
            )}

            {view === "lights" && (
              <LightGroups css={{ gridColumn: "1 / span 4" }} groups={groups} />
            )}

            {view === "motion" && (
              <Motion
                css={{ gridColumn: "1 / span 4" }}
                sensors={outside.concat(insideCold).concat(inside)}
                error={!!error}
              />
            )}

            {view === "history" && (
              <History css={{ gridColumn: "1 / span 4" }} />
            )}

            {view === "settings" && (
              <div
                css={{
                  gridColumn: "1 / span 4",
                  backgroundColor: theme.colors.background.main,
                  boxShadow: theme.shadows.main,
                  borderRadius: theme.border.radius,
                  padding: "1.5em",
                  minHeight: 250,
                }}
              >
                <LocationForm css={{ marginBottom: "1.5em" }} />
                <div
                  css={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "0.5em",
                    color: theme.colors.text.main,
                    ...theme.typography.caption,
                  }}
                >
                  <Icon css={{ opacity: 1 }} size={16}>
                    local_offer
                  </Icon>
                  {import.meta.env.VITE_HALO_IMAGE_TAG}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default App;
