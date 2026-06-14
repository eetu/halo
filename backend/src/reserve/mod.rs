//! Reserve-market payout — read-only consumer of the `reserve_*` tables that an
//! external updater writes (halo never fetches the upstream itself). halo owns the
//! generic fee MODEL + payout math here; the fee VALUES are written by the updater.
pub mod handlers;
pub mod models;
pub mod storage;
