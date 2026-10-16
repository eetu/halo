import type { FC } from "react";

type SparklineSeries = {
  points: number[];
  color: string;
};

type SparklineProps = {
  /**
   * Lines on one shared scale, lowest first, all the same length. Each fills
   * down to the one below; the first line draws on top where they meet.
   */
  series: SparklineSeries[];
  height?: number;
  className?: string;
};

const Sparkline: FC<SparklineProps> = ({ series, height = 50, className }) => {
  const length = series[0]?.points.length ?? 0;
  if (length < 2) return null;

  const all = series.flatMap((s) => s.points);
  const minY = Math.min(...all);
  const maxY = Math.max(...all);
  const range = maxY - minY || 1;
  const width = 200;
  const stepX = width / (length - 1);
  const padY = 2;

  const lines = series.map((s) =>
    s.points.map((y, i) => {
      const py = height - padY - ((y - minY) / range) * (height - 2 * padY);
      return `${(i * stepX).toFixed(2)},${py.toFixed(2)}`;
    }),
  );

  return (
    <svg
      className={className}
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {lines.map((line, i) => {
        const below = i === 0 ? [`${width},${height}`, `0,${height}`] : [...lines[i - 1]].reverse();
        return (
          <path
            key={`fill-${series[i].color}`}
            d={`M${[...line, ...below].join(" L")} Z`}
            fill={series[i].color}
            opacity={0.18}
          />
        );
      })}
      {lines
        .map((line, i) => (
          <path
            key={`line-${series[i].color}`}
            d={`M${line.join(" L")}`}
            fill="none"
            stroke={series[i].color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))
        .reverse()}
    </svg>
  );
};

export default Sparkline;
