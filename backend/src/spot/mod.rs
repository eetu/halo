//! Finnish spot electricity prices — fetched straight from the TSO-grade open
//! source (Elering LIVE, the Estonian TSO's Nord Pool day-ahead feed), keyless,
//! like the weather sources. EUR/MWh ex-VAT → c/kWh incl VAT, 15-min → hourly.
pub mod client;
pub mod handlers;
pub mod models;
