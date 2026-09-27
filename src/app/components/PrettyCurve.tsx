import { useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Area } from "recharts";

export default function PrettyCurve({
  values,
  secondaryValues,
  height = 240,
  gradientId = "prettyGrad",
  color = "#facc15",
  colorSecondary = "#6b7280",
  yAxisFormatter,
}: {
  values: number[];
  secondaryValues?: number[];
  height?: number;
  gradientId?: string;
  color?: string;
  colorSecondary?: string;
  yAxisFormatter?: (value: number) => string;
}) {
  const data = useMemo(() => {
    if (!values || values.length === 0) return [];
    return values.map((v, i) => ({
      x: i + 1,
      y: v,
      y2: secondaryValues ? secondaryValues[i] : undefined,
    }));
  }, [values, secondaryValues]);

  if (data.length === 0) {
    return <div className="h-60 flex items-center justify-center text-sm text-gray-500">No data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2ff" vertical={false} />
        <XAxis dataKey="x" tick={{ fontSize: 11 }} axisLine={false} />
        <YAxis 
          domain={['auto', 'auto']}
          tickFormatter={yAxisFormatter ? yAxisFormatter : (v) => (Number.isInteger(v) ? v.toString() : v.toFixed(1))} 
          tick={{ fontSize: 11 }} 
          axisLine={false} 
          width={45} 
        />
        <Tooltip
          formatter={() => null}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const p = payload[0].payload as any;
            return (
              <div className="rounded border bg-white p-2 text-sm shadow">
                <div className="font-medium">Gen {p.x}</div>
                <div className="text-xs text-gray-600">Primary: {p.y?.toFixed ? p.y.toFixed(4) : p.y}</div>
                {p.y2 !== undefined && <div className="text-xs text-gray-600">Secondary: {p.y2?.toFixed ? p.y2.toFixed(4) : p.y2}</div>}
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="y" stroke="none" fill={`url(#${gradientId})`} />
        <Line type="monotone" dataKey="y" stroke={color} strokeWidth={3} dot={false} isAnimationActive={false} />
        {secondaryValues && <Line type="monotone" dataKey="y2" stroke={colorSecondary} strokeWidth={2} dot={false} isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
