import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PrettyCurve from "../app/components/PrettyCurve";

type PlotPoint = {x: number; y: number; y2?: number};
const plot = vi.hoisted(() => ({data: [] as PlotPoint[]}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({children}: {children: ReactNode}) => children,
  ComposedChart: ({data, children}: {data: PlotPoint[]; children: ReactNode}) => {
    plot.data = data;
    return <><output aria-label="Plotted generations">{JSON.stringify(data.map(point => point.x))}</output><svg>{children}</svg></>;
  },
  Tooltip: ({content}: {content: (props: {active: boolean; payload: Array<{payload: PlotPoint}>}) => ReactNode}) => <foreignObject>{content({active: true, payload: [{payload: plot.data[plot.data.length - 1]}]})}</foreignObject>,
  XAxis: () => null, YAxis: () => null, Line: () => null, Area: () => null, CartesianGrid: () => null,
}));

it("uses actual sparse generation numbers for chart data and tooltip labels", () => {
  render(<PrettyCurve values={[89.948, 89.9713]} secondaryValues={[89.948, 89.9596]} generations={[88, 89]} />);
  expect(screen.getByLabelText("Plotted generations").textContent).toBe("[88,89]");
  expect(screen.getByText("Gen 89")).toBeTruthy();
  expect(screen.getByText("Primary: 89.9713")).toBeTruthy();
  expect(screen.getByText("Secondary: 89.9596")).toBeTruthy();
});

it("preserves generation labels for a window taken from a longer history", () => {
  const generations = Array.from({length: 200}, (_, index) => index + 101);
  render(<PrettyCurve values={generations.map(generation => 89 + generation / 1000)} generations={generations} />);
  expect(JSON.parse(screen.getByLabelText("Plotted generations").textContent ?? "[]")).toEqual(generations);
  expect(screen.getByText("Gen 300")).toBeTruthy();
});

it("keeps one-based defaults and updates labels when generation coordinates change", () => {
  const values = [89.948, 89.9713];
  const {rerender} = render(<PrettyCurve values={values} />);
  expect(screen.getByLabelText("Plotted generations").textContent).toBe("[1,2]");
  rerender(<PrettyCurve values={values} generations={[88, 89]} />);
  expect(screen.getByLabelText("Plotted generations").textContent).toBe("[88,89]");
  expect(screen.getByText("Gen 89")).toBeTruthy();
});
