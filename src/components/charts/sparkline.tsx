/**
 * 迷你趋势线：纯 SVG 折线，用于排行行内的趋势示意。
 * 无数据（全 0 或空数组）时渲染占位符 "—"。
 */
export function Sparkline({
  data,
  width = 72,
  height = 22,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  const values = data ?? [];
  const hasData = values.some((v) => v > 0);

  if (values.length < 2 || !hasData) {
    return (
      <span className="text-xs text-muted-foreground/50" aria-hidden="true">
        —
      </span>
    );
  }

  const max = Math.max(...values);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - 3 - (v / max) * (height - 6);
    return { x, y };
  });
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground/70"
      />
      <circle cx={last.x} cy={last.y} r="2" className="fill-foreground" />
    </svg>
  );
}
