"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface Props {
  data: { date: string; points: number }[];
}

export function AccuracyChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No scored picks yet.</p>;
  }
  const series = data.reduce<{ date: string; cumulative: number }[]>((acc, d) => {
    const prev = acc.at(-1)?.cumulative ?? 0;
    acc.push({ date: d.date, cumulative: prev + d.points });
    return acc;
  }, []);
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={series}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
          <YAxis stroke="var(--muted)" fontSize={11} />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
            labelStyle={{ color: "var(--muted)" }}
          />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
