import { useTheme } from "@emotion/react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  ChartData,
  ChartOptions,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
} from "chart.js";
import ChartDataLabels, { Context } from "chartjs-plugin-datalabels";
import React from "react";
import { Chart } from "react-chartjs-2";
import { useMediaQuery } from "usehooks-ts";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
);

type WeatherChartData = {
  temp: number;
  rain: number;
  pvKwh?: number | null;
  label: string;
};

type WeatherChartProps = {
  data: Array<WeatherChartData>;
  days?: number;
};

const fitsInsideBar = (ctx: Context, charPx: number): boolean => {
  const value = ctx.dataset.data[ctx.dataIndex] as number | null;
  if (value == null) return true;
  const scale = ctx.chart.scales.yPv;
  if (!scale) return true;
  const barHeight = Math.abs(scale.getPixelForValue(value) - scale.getPixelForValue(0));
  const text = `${value.toFixed(0)} kWh`;
  return barHeight >= text.length * charPx + 4;
};

const WeatherChart: React.FC<WeatherChartProps> = ({ data: unfilteredData, days }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery("(max-width: 600px)");
  const labelFontSize = isMobile ? 8 : 10;
  const labelCharPx = isMobile ? 5 : 6.5;

  const data = days === undefined ? unfilteredData : unfilteredData.slice(0, days);

  const avgTemp = data.map((d) => d.temp).reduce((a, b) => a + b, 0) / data.length;

  const weatherLineColor = avgTemp < 5 ? theme.colors.cool : theme.colors.warm;

  const hasPv = data.some((d) => d.pvKwh != null);

  const datasets: ChartData["datasets"] = [
    {
      type: "line",
      yAxisID: "yTemp",
      data: data.map((d) => d.temp),
      borderColor: weatherLineColor,
      pointRadius: 0,
      cubicInterpolationMode: "monotone",
    },
    {
      type: "bar",
      yAxisID: "yRain",
      data: data.map((d) => d.rain),
      backgroundColor: theme.mode === "dark" ? "#43529c" : "#94daf7",
    },
  ];

  if (hasPv) {
    datasets.push({
      type: "bar",
      yAxisID: "yPv",
      data: data.map((d) => d.pvKwh ?? null),
      backgroundColor: theme.mode === "dark" ? "#a35a00" : "#f5a524",
      barPercentage: 0.7,
      categoryPercentage: 0.75,
      datalabels: {
        display: true,
        rotation: -90,
        clip: false,
        font: { size: labelFontSize, weight: "bold" },
        formatter: (v: number | null) => (v == null ? "" : `${v.toFixed(0)} kWh`),
        anchor: (ctx: Context) => (fitsInsideBar(ctx, labelCharPx) ? "center" : "end"),
        align: (ctx: Context) => (fitsInsideBar(ctx, labelCharPx) ? "center" : "top"),
        color: (ctx: Context) =>
          fitsInsideBar(ctx, labelCharPx)
            ? "#ffffff"
            : theme.mode === "dark"
              ? "#f5a524"
              : "#a35a00",
      },
    });
  }

  const chartData: ChartData = {
    labels: data.map((d) => d.label),
    datasets,
  };

  const options: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
      // Plugin scoped to this chart via the `plugins` prop on <Chart>.
      // Disabled at chart level — re-enabled per-dataset on PV bars only.
      datalabels: { display: false },
    },
    scales: {
      x: {
        beginAtZero: false,
        grid: {
          display: false,
        },
        ticks: { color: theme.mode === "dark" ? "#d6d6d6" : "#525252" },
      },
      yTemp: {
        position: "left",
        grid: {
          tickBorderDash: [2, 2],
        },
        ticks: {
          precision: 0,
          color: theme.mode === "dark" ? "#d6d6d6" : "#525252",
          callback: (v) => `${v} °`,
        },
      },
      yRain: {
        position: "right",
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          precision: 0,
          color: theme.mode === "dark" ? "#d6d6d6" : "#525252",
          callback: (v) => `${v} mm`,
        },
      },
      ...(hasPv
        ? {
            yPv: {
              position: "right",
              display: false,
              beginAtZero: true,
              grid: { drawOnChartArea: false },
            },
          }
        : {}),
    },
  };

  return <Chart type="bar" options={options} data={chartData} plugins={[ChartDataLabels]} />;
};

export default WeatherChart;
