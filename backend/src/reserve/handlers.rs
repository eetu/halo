use std::sync::Arc;

use actix_web::{web, HttpResponse};
use chrono::{Days, NaiveDate};
use serde::Deserialize;
use utoipa::IntoParams;

use super::models::{FeeRow, ReservePoint, ReserveResponse};
use crate::AppState;

#[derive(Debug, Deserialize, IntoParams)]
pub struct ReserveQuery {
    /// Resolution: hour|day|week|month|year (default: month).
    pub steps: Option<String>,
    /// Provider key (default: the single configured provider).
    pub provider: Option<String>,
}

const CURRENCY: &str = "EUR";

#[utoipa::path(
    get,
    path = "/api/reserve",
    params(ReserveQuery),
    responses(
        (status = 200, description = "Reserve-market payout series", body = super::models::ReserveResponse),
        (status = 500, description = "Database error"),
    )
)]
pub async fn get_reserve(
    state: web::Data<Arc<AppState>>,
    query: web::Query<ReserveQuery>,
) -> HttpResponse {
    let steps = query.steps.clone().unwrap_or_else(|| "month".into());
    let provider = query
        .provider
        .clone()
        .unwrap_or_else(|| state.settings.reserve_provider.clone());

    let rows = match state.storage.query_reserve_profit(&provider, &steps).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("reserve: failed to read profit rows: {e}");
            return HttpResponse::InternalServerError().finish();
        }
    };
    // The fee is a monthly amount, so payout is only meaningful at month resolution.
    let fee_applied = steps == "month";
    let fees = if fee_applied {
        state
            .storage
            .query_reserve_fees(&provider)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let display_name = state
        .storage
        .query_reserve_display_name(&provider)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| provider.clone());

    let mut points = Vec::with_capacity(rows.len());
    let (mut total_gross, mut total_payout, mut total_spot) = (0.0, 0.0, 0.0);

    for r in &rows {
        let gross = r.fcr_up + r.fcr_down;
        let (fee, payout) = if fee_applied {
            match fee_for(&fees, &r.bucket_start) {
                Some(rule) => rule.apply(r.capacity_kw, gross),
                None => {
                    tracing::warn!(
                        "reserve: no fee period covers {} for {provider}; payout = gross",
                        r.bucket_start
                    );
                    (0.0, gross)
                }
            }
        } else {
            (0.0, gross)
        };

        total_gross += gross;
        total_payout += payout;
        total_spot += r.spot_saving;

        points.push(ReservePoint {
            bucket_start: r.bucket_start.clone(),
            fcr_up: r.fcr_up,
            fcr_down: r.fcr_down,
            gross,
            spot_saving: r.spot_saving,
            fee,
            payout,
            is_final: r.is_final,
        });
    }

    HttpResponse::Ok().json(ReserveResponse {
        provider,
        display_name,
        currency: CURRENCY.into(),
        steps,
        fee_applied,
        total_gross,
        total_payout,
        total_spot_saving: total_spot,
        points,
    })
}

/// Find the fee rule covering a bucket. Buckets are stored in UTC but aligned to
/// the provider's local month, so a bucket can read `...-05-31T21:00:00Z` for the
/// following month; a 2-day cushion lands classification firmly inside the
/// intended month before the half-open `[from, to)` lookup.
fn fee_for<'a>(fees: &'a [FeeRow], bucket_start: &str) -> Option<&'a super::models::FeeRule> {
    let dt = chrono::DateTime::parse_from_rfc3339(bucket_start).ok()?;
    let date: NaiveDate = dt
        .with_timezone(&chrono::Utc)
        .checked_add_days(Days::new(2))?
        .date_naive();
    fees.iter()
        .find(|f| f.from <= date && f.to.is_none_or(|t| date < t))
        .map(|f| &f.rule)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reserve::models::{FeeRow, FeeRule};

    fn eras() -> Vec<FeeRow> {
        vec![
            FeeRow {
                from: NaiveDate::from_ymd_opt(2025, 11, 1).unwrap(),
                to: Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()),
                rule: FeeRule::Flat {
                    amount: 30.0,
                    vat_included: true,
                },
            },
            FeeRow {
                from: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
                to: None,
                rule: FeeRule::PerKw {
                    rate: 2.0,
                    min: 19.0,
                    vat_included: true,
                },
            },
        ]
    }

    #[test]
    fn june_bucket_aligned_to_local_month_picks_new_era() {
        // A month's bucket is stored at the prior 21:00Z (local-time offset). The
        // 2-day cushion must still classify it into the later (per_kw) era, not the
        // earlier one.
        let eras = eras();
        let rule = fee_for(&eras, "2026-05-31T21:00:00.000Z").expect("covered");
        assert!(matches!(rule, FeeRule::PerKw { .. }));
    }

    #[test]
    fn may_bucket_picks_old_flat_era() {
        let eras = eras();
        let rule = fee_for(&eras, "2026-04-30T21:00:00.000Z").expect("covered");
        assert!(matches!(rule, FeeRule::Flat { .. }));
    }
}
