import { FC } from "react";

type SparklineProps = {
  points: number[];
  color: string;
  height?: number;
  className?: string;
};

const Sparkline: FC<SparklineProps> = ({ points, color, height = 50, className }) => {
  if (points.length < 2) return null;

  const minY = Math.min(...points);
  const maxY = Math.max(...points);
  const range = maxY - minY || 1;
  const width = 200;
  const stepX = width / (points.length - 1);
  const padY = 2;

  const coords = points.map(
    (y, i) => [i * stepX, height - padY - ((y - minY) / range) * (height - 2 * padY)] as const,
  );
  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const fillPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg
      className={className}
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={fillPath} fill={color} opacity={0.18} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

export default Sparkline;
