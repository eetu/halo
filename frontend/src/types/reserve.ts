export type ReservePoint = {
  bucketStart: string;
  fcrUp: number;
  fcrDown: number;
  /** Reserve income only (fcrUp + fcrDown), excludes spotSaving. */
  gross: number;
  spotSaving: number;
  fee: number;
  payout: number;
  isFinal: boolean;
};

export type ReserveResponse = {
  provider: string;
  displayName: string;
  currency: string;
  steps: string;
  /** True only at monthly resolution — payout is a monthly figure. */
  feeApplied: boolean;
  totalGross: number;
  totalPayout: number;
  totalSpotSaving: number;
  points: ReservePoint[];
};
