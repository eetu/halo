export type HourPrice = {
  hour: string; // local-time hour start, RFC3339
  price: number; // c/kWh incl. VAT
};

export type SpotResponse = {
  unit: string;
  today: HourPrice[];
  tomorrow: HourPrice[];
  todayAverage: number;
};
