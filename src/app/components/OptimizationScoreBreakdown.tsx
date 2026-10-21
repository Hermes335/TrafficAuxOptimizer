import type { OptimizationScoreBreakdown as SavedBreakdown } from "../services/backend";

const points = (value: number) => value.toFixed(4);
const signedPoints = (value: number, digits = 4) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

export function OptimizationScoreBreakdown({ breakdown }: { breakdown?: SavedBreakdown }) {
  if (!breakdown) return <section aria-label="Score breakdown" className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-6">
    <h2 className="text-lg font-semibold">Score breakdown</h2>
    <p className="mt-2 text-sm text-slate-600">Score breakdown unavailable for this saved run. Its recorded overall score is retained.</p>
  </section>;
  const objectivePoints = breakdown.components.reduce((sum, component) => sum + component.contribution, 0);
  return <section aria-label="Score breakdown" className="mb-6 min-w-0 rounded-xl bg-white p-4 shadow-sm sm:p-6">
    <h2 className="text-lg font-semibold">Score breakdown</h2>
    <p className="mt-2 text-sm text-slate-600">Saved objective scores, normalized weights and their contributions to the final score. Higher objective scores are better.</p>
    {breakdown.basis === "time_weighted_final_assignments" && <p className="mt-2 text-xs text-slate-500">Scores and adjustments are weighted by each planning period's duration.</p>}
    <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {breakdown.components.map(component => <section key={component.key} aria-label={`${component.label} score component`} className="min-w-0 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-medium text-slate-800">{component.label}</h3>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div><dt className="text-slate-500">Score</dt><dd className="mt-1 font-medium">{points(component.score)}</dd></div>
          <div><dt className="text-slate-500">Weight</dt><dd className="mt-1 font-medium">{(component.weight * 100).toFixed(2)}%</dd></div>
          <div><dt className="text-slate-500">Points</dt><dd className="mt-1 font-semibold">{points(component.contribution)}</dd></div>
        </dl>
      </section>)}
    </div>
    <div className="mt-4 grid gap-4 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2">
      <dl className="space-y-2">
        <div className="flex justify-between gap-3"><dt>Weighted objectives</dt><dd className="font-medium tabular-nums">{points(objectivePoints)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Incident bonus</dt><dd className="font-medium tabular-nums">{signedPoints(breakdown.incident_bonus.contribution)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Constraint adjustment</dt><dd className="font-medium tabular-nums">{signedPoints(breakdown.constraint_adjustment, 6)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Rounding adjustment</dt><dd className="font-medium tabular-nums">{signedPoints(breakdown.rounding_adjustment, 6)}</dd></div>
        <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-semibold"><dt>Overall score</dt><dd className="tabular-nums">{points(breakdown.total)}</dd></div>
      </dl>
      <div className="space-y-2 text-xs leading-relaxed text-slate-600">
        <p>Weighted objectives + incident bonus + adjustments = overall score.</p>
        <p>Values are rounded for display.</p>
        <p>Incident bonus: score {points(breakdown.incident_bonus.score)} × weight {breakdown.incident_bonus.weight.toFixed(4)} = {points(breakdown.incident_bonus.contribution)} points.</p>
        <p>The incident bonus can raise the overall score above 100. This is a recommendation score, not a measured traffic improvement.</p>
      </div>
    </div>
  </section>;
}
