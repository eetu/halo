use serde::Serialize;

/// The default FMI radar layer: nationwide rain *rate* (`rr`) composite, updated
/// every 5 minutes. Chosen over the reflectivity composite
/// (`Radar:suomi_dbz_eureffin`) because its band is mm/h × 100 — the same unit as
/// the HARMONIE forecast overlay — so one legend and one colour ramp describe the
/// whole timeline. The frontend restyles these tiles with its own ramp via
/// `SLD_BODY`; dBZ could only ever be labelled qualitatively.
pub const DEFAULT_LAYER: &str = "Radar:suomi_rr_eureffin";

/// Animation frames for the rain radar. `times` is ascending (oldest first),
/// formatted as the ISO8601 instants FMI's WMS `time` dimension accepts.
#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
pub struct RadarFrames {
    /// The WMS layer these frames belong to.
    pub layer: String,
    /// Frame timestamps, ascending (e.g. `2026-06-22T17:50:00Z`).
    pub times: Vec<String>,
    /// Spacing between frames in minutes.
    #[serde(rename = "intervalMinutes")]
    pub interval_minutes: u32,
}

/// Gridded precipitation forecast (FMI HARMONIE), decoded from GRIB2 and
/// resampled to a coarse north-up lat/lon grid the frontend renders as a heat
/// overlay. The grid is regular in EPSG:4326, so `bbox` + `rows`/`cols` place
/// every cell.
#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
pub struct PrecipForecast {
    /// Grid extent as `[south, west, north, east]` in degrees (WGS84).
    pub bbox: [f64; 4],
    /// Columns (west→east) in each frame's `values`.
    pub cols: usize,
    /// Rows (north→south) in each frame's `values`.
    pub rows: usize,
    /// Value unit, e.g. `mm/h`.
    pub unit: String,
    /// Forecast steps, ascending in time.
    pub frames: Vec<ForecastFrame>,
}

/// One forecast time step.
#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
pub struct ForecastFrame {
    /// Valid time, e.g. `2026-06-22T19:00:00Z`.
    pub time: String,
    /// Peak value across the grid (lets the frontend skip empty frames cheaply).
    pub max: f32,
    /// Row-major, north-up (row 0 = north), west→east. Length = `rows * cols`.
    pub values: Vec<f32>,
}
