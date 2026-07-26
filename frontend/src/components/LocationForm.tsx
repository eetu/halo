import { useTheme } from "@emotion/react";
import { useCallback, useEffect, useState } from "react";

import { getCityName, type NominatimResult, reverseGeocode, searchLocation } from "../geo";
import useGeoLocation from "../hooks/useGeoLocation";
import useLocationSettings from "../hooks/useLocationSettings";
import useScreenshotMode from "../hooks/useScreenshotMode";
import Icon from "./Icon";

type LocationFormProps = {
  className?: string;
};

const LocationForm: React.FC<LocationFormProps> = ({ className }) => {
  const theme = useTheme();
  const { location, saveLocation } = useLocationSettings();
  const geo = useGeoLocation();
  const demo = useScreenshotMode();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleDetect = useCallback(async () => {
    if (query.trim()) {
      setSearching(true);
      try {
        const res = await searchLocation(query.trim());
        setResults(res);
      } finally {
        setSearching(false);
      }
    } else {
      geo.detect();
    }
  }, [query, geo]);

  useEffect(() => {
    if (!geo.position) return;
    let cancelled = false;

    (async () => {
      const result = await reverseGeocode(geo.position!.lat, geo.position!.lon);
      if (cancelled) return;
      const city = getCityName(result);
      saveLocation({
        lat: geo.position!.lat,
        lon: geo.position!.lon,
        displayName: city,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [geo.position, saveLocation]);

  const selectResult = (result: NominatimResult) => {
    const city = getCityName(result);
    saveLocation({
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      displayName: city,
    });
    setResults([]);
    setQuery("");
  };

  const loading = searching || geo.loading;

  return (
    <div className={className} css={{ display: "flex", flexDirection: "column", gap: "0.5em" }}>
      <div
        css={{
          display: "flex",
          alignItems: "center",
          gap: "0.5em",
          color: theme.colors.text.main,
          ...theme.typography.caption,
        }}
      >
        <Icon size={16}>location_on</Icon>
        sijainti
      </div>

      {location && (
        <div
          css={{
            color: theme.colors.text.main,
            ...theme.typography.body2,
            marginBottom: "0.25em",
          }}
        >
          {demo ? "—" : location.displayName}
        </div>
      )}

      <div css={{ display: "flex", gap: "0.5em", position: "relative" }}>
        <input
          type="text"
          placeholder="kaupunki tai osoite"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleDetect()}
          css={{
            flex: 1,
            padding: "0.5em 0.75em",
            borderRadius: 6,
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.background.light,
            color: theme.colors.text.main,
            ...theme.typography.body2,
            outline: "none",
            "&:focus": {
              borderColor: theme.colors.text.muted,
            },
          }}
        />
        <button
          onClick={handleDetect}
          disabled={loading}
          css={{
            padding: "0.5em 1em",
            borderRadius: 6,
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.background.light,
            color: theme.colors.text.main,
            cursor: loading ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.35em",
            ...theme.typography.body2,
            "&:hover": {
              backgroundColor: theme.colors.background.main,
            },
          }}
        >
          <Icon size={16}>{query.trim() ? "search" : "my_location"}</Icon>
          {query.trim() ? "hae" : "paikanna"}
        </button>
      </div>

      {geo.error && (
        <div css={{ color: theme.colors.error, ...theme.typography.caption }}>{geo.error}</div>
      )}

      {results.length > 0 && (
        <div
          css={{
            display: "flex",
            flexDirection: "column",
            borderRadius: 6,
            border: `1px solid ${theme.colors.border}`,
            overflow: "hidden",
          }}
        >
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lon}`}
              onClick={() => selectResult(r)}
              css={{
                padding: "0.6em 0.75em",
                border: "none",
                borderBottom: i < results.length - 1 ? `1px solid ${theme.colors.border}` : "none",
                backgroundColor: theme.colors.background.light,
                color: theme.colors.text.main,
                textAlign: "left",
                cursor: "pointer",
                ...theme.typography.body2,
                "&:hover": {
                  backgroundColor: theme.colors.background.main,
                },
              }}
            >
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LocationForm;
