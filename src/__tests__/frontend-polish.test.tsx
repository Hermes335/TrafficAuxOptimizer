import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BottleneckDetailPanel } from "../app/pages/Dashboard/components/BottleneckDetailPanel";
import type { Bottleneck, TrafficReading } from "../app/services/backend";
import { getCongestionSeverity } from "../app/types/severity";

const node: Bottleneck = { id: "A", name: "Pilot junction", status: "normal", latitude: 10.7, longitude: 122.5 };
const reading: TrafficReading = {
  bottleneck: "A", timestamp: new Date().toISOString(), observed_at: new Date().toISOString(), fetched_at: null,
  traffic_severity_index: 0, source: "tomtom", data_status: "live", is_stale: false, is_synthetic: false,
};
function details(bottleneck: Bottleneck, trafficReading?: TrafficReading) {
  return render(<BottleneckDetailPanel bottleneck={bottleneck} trafficReading={trafficReading}
    onClose={vi.fn()} onDelete={vi.fn()} deletingId={null} canManage={true} />);
}

it("missing traffic and missing schedule are not shown as free flow and zero deployment", () => {
  details(node);
  expect(screen.queryByText("Free flow")).toBeNull();
  expect(screen.getByText("No traffic reading available")).toBeTruthy();
  expect(screen.getByText("Current schedule unavailable")).toBeTruthy();
  expect(getCongestionSeverity(node)).toBe("unknown");
});

it("a genuine zero traffic reading is displayed as free flow with its provenance", () => {
  details({ ...node, tsi: 0, current_assigned: 0, current_required: 0 }, reading);
  expect(screen.getByText("0%")).toBeTruthy();
  expect(screen.getByText("Free flow")).toBeTruthy();
  expect(screen.getByText(/Live · observed/)).toBeTruthy();
  expect(screen.getByText("No officers required now")).toBeTruthy();
});

it("an old reading labelled live by its source still displays the server's stale flag", () => {
  details(node, { ...reading, observed_at: new Date(Date.now() - 3600000).toISOString(), is_stale: true });
  expect(screen.getByText(/Stale · observed 1 hr ago/)).toBeTruthy();
  expect(screen.queryByText(/Live · observed/)).toBeNull();
});

it("a timestamp with an unavailable reading cannot establish free flow", () => {
  details(node, { ...reading, available: false, data_status: "unavailable" });
  expect(screen.queryByText("Free flow")).toBeNull();
  expect(screen.getByText("No traffic reading available")).toBeTruthy();
});
