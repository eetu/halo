use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A stored profit bucket (raw DB row).
#[derive(Debug, Clone)]
pub struct ProfitRow {
    pub bucket_start: String,
    pub fcr_up: f64,
    pub fcr_down: f64,
    pub spot_saving: f64,
    pub capacity_kw: f64,
    pub is_final: bool,
}

/// One time-versioned fee period.
#[derive(Debug, Clone)]
pub struct FeeRow {
    pub from: chrono::NaiveDate,
    pub to: Option<chrono::NaiveDate>,
    pub rule: FeeRule,
}

/// The generic fee model (mirrors the updater's `fees.toml`). `flat`/`tiered`/
/// `per_kw` are subtractive thresholds (payout floored at 0); `percent` scales.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FeeRule {
    None,
    Flat {
        amount: f64,
        #[serde(default)]
        vat_included: bool,
    },
    Tiered {
        brackets: Vec<Bracket>,
        #[serde(default)]
        vat_included: bool,
    },
    PerKw {
        rate: f64,
        #[serde(default)]
        min: f64,
        #[serde(default)]
        vat_included: bool,
    },
    Percent {
        rate: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bracket {
    /// Upper bound (kW) for this bracket; `None` = top/open bracket.
    pub up_to_kw: Option<f64>,
    pub amount: f64,
}

impl FeeRule {
    /// Monthly fee amount for a measured capacity and gross reserve income.
    pub fn amount(&self, capacity_kw: f64, gross: f64) -> f64 {
        match self {
            FeeRule::None => 0.0,
            FeeRule::Flat { amount, .. } => *amount,
            FeeRule::PerKw { rate, min, .. } => (rate * capacity_kw).max(*min),
            FeeRule::Tiered { brackets, .. } => brackets
                .iter()
                .find(|b| b.up_to_kw.is_none_or(|c| capacity_kw <= c))
                .map(|b| b.amount)
                .unwrap_or(0.0),
            FeeRule::Percent { rate } => rate * gross,
        }
    }

    pub fn is_percent(&self) -> bool {
        matches!(self, FeeRule::Percent { .. })
    }

    /// `(fee, payout)` for a month. Threshold-type fees floor payout at 0 (the
    /// provider never bills below zero); `percent` scales income instead.
    pub fn apply(&self, capacity_kw: f64, gross: f64) -> (f64, f64) {
        let fee = self.amount(capacity_kw, gross);
        let payout = if self.is_percent() {
            gross - fee
        } else {
            (gross - fee).max(0.0)
        };
        (fee, payout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_flat_fee_floors_to_zero() {
        // May 2026 gross €27.82 under the old ~€30 flat era → €0 payout.
        let rule = FeeRule::Flat {
            amount: 30.0,
            vat_included: true,
        };
        let (fee, payout) = rule.apply(9.0, 27.82);
        assert_eq!(fee, 30.0);
        assert_eq!(payout, 0.0);
    }

    #[test]
    fn new_per_kw_fee_clears_threshold() {
        // From June 2026: 2 €/kW, min €19. 9 kW → max(19, 18) = €19 → €27.82 nets €8.82.
        let rule = FeeRule::PerKw {
            rate: 2.0,
            min: 19.0,
            vat_included: true,
        };
        let (fee, payout) = rule.apply(9.0, 27.82);
        assert_eq!(fee, 19.0);
        assert!((payout - 8.82).abs() < 1e-9);
    }

    #[test]
    fn percent_scales_income() {
        let rule = FeeRule::Percent { rate: 0.2 };
        let (fee, payout) = rule.apply(9.0, 100.0);
        assert!((fee - 20.0).abs() < 1e-9);
        assert!((payout - 80.0).abs() < 1e-9);
    }

    #[test]
    fn tiered_picks_bracket_by_capacity() {
        let rule = FeeRule::Tiered {
            vat_included: true,
            brackets: vec![
                Bracket {
                    up_to_kw: Some(5.0),
                    amount: 19.0,
                },
                Bracket {
                    up_to_kw: None,
                    amount: 34.9,
                },
            ],
        };
        assert_eq!(rule.amount(4.0, 0.0), 19.0);
        assert_eq!(rule.amount(9.0, 0.0), 34.9);
    }
}

/// One point in the payout series returned to the frontend.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservePoint {
    pub bucket_start: String,
    pub fcr_up: f64,
    pub fcr_down: f64,
    /// Reserve income only (fcr_up + fcr_down) — excludes spot_saving.
    pub gross: f64,
    /// Provider's estimated spot-arbitrage saving; surfaced separately, never
    /// summed into payout.
    pub spot_saving: f64,
    pub fee: f64,
    pub payout: f64,
    pub is_final: bool,
}

/// The reserve payout series + headline totals.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReserveResponse {
    pub provider: String,
    pub display_name: String,
    pub currency: String,
    pub steps: String,
    /// True only at monthly resolution — the fee is a monthly amount, so payout is
    /// only meaningful per month. Other resolutions return gross with fee = 0.
    pub fee_applied: bool,
    pub total_gross: f64,
    pub total_payout: f64,
    pub total_spot_saving: f64,
    pub points: Vec<ReservePoint>,
}
