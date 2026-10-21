import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { OptimizationScoreBreakdown } from "../app/components/OptimizationScoreBreakdown";
import { computeAutoWeights } from "../app/hooks/useOptimizationConfig";
import type { OptimizationScoreBreakdown as SavedBreakdown } from "../app/services/backend";

const breakdown: SavedBreakdown = {
  version: "fitness-breakdown-v1", basis: "time_weighted_final_assignments",
  components: [
    {key: "coverage", label: "Coverage", score: 100, weight: 0.4, contribution: 40},
    {key: "estimated_travel", label: "Estimated travel", score: 80, weight: 0.2, contribution: 16},
    {key: "road_priority", label: "Road priority", score: 90, weight: 0.2, contribution: 18},
    {key: "staffing_efficiency", label: "Staffing efficiency", score: 100, weight: 0.2, contribution: 20},
  ],
  incident_bonus: {score: 100, weight: 0.15, contribution: 15},
  constraint_adjustment: -2.34567, rounding_adjustment: -0.00003, total: 106.6543,
};

it("displays saved contributions, bonus, negative penalties and rounding as the actual score arithmetic", () => {
  render(<OptimizationScoreBreakdown breakdown={breakdown} />);
  const coverage = screen.getByRole("region", {name: "Coverage score component"});
  expect(within(coverage).getByText("100.0000")).toBeTruthy();
  expect(within(coverage).getByText("40.00%")).toBeTruthy();
  expect(within(coverage).getByText("40.0000")).toBeTruthy();
  const row = (label: string) => screen.getByText(label).parentElement?.textContent;
  expect(row("Weighted objectives")).toBe("Weighted objectives94.0000");
  expect(row("Incident bonus")).toBe("Incident bonus+15.0000");
  expect(row("Constraint adjustment")).toBe("Constraint adjustment-2.345670");
  expect(row("Rounding adjustment")).toBe("Rounding adjustment-0.000030");
  expect(row("Overall score")).toBe("Overall score106.6543");
  expect(screen.getByText(/weighted by each planning period's duration/)).toBeTruthy();
  expect(screen.getByText(/overall score above 100/)).toBeTruthy();
});

it("does not manufacture a breakdown for a saved run without one", () => {
  render(<OptimizationScoreBreakdown />);
  expect(screen.getByText(/Score breakdown unavailable for this saved run/)).toBeTruthy();
  expect(screen.queryByText("Weighted objectives")).toBeNull();
  expect(screen.queryByText("Incident bonus")).toBeNull();
});

it("renames auto-weight explanations without changing the computed weights", () => {
  const suggestion = computeAutoWeights([{tsi: 0.6}], 1.6, [{type: "critical"}], 20);
  expect(suggestion).toMatchObject({tsiWeight: 34, wifWeight: 28, rpwWeight: 28, resourceUtilizationWeight: 10});
  expect(suggestion.reasons.join(" ")).toContain("Coverage weight boosted");
  expect(suggestion.reasons.join(" ")).toContain("Estimated travel weight boosted");
  expect(suggestion.reasons.join(" ")).toContain("Road priority weight boosted");
});
