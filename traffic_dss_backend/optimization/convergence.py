"""Conservative progress checks across every scored objective, without changing fitness."""
from math import isfinite

CONVERGENCE_POLICY_VERSION = "all-objectives-progress-v1"
MINIMUM_GENERATIONS = 50
PATIENCE = 20
TOLERANCE = 0.0001
OBJECTIVES = ("coverage_efficiency", "response_time_score", "road_priority_coverage", "staffing_efficiency", "fitness")


class ConvergenceTracker:
    """Stop after a warmup and sustained lack of material objective/fitness gains.

    This checks the best attained value of each objective and weighted fitness.
    It is a bounded stopping heuristic, not a proof of Pareto or global optimality.
    """

    def __init__(self, minimum_generations=MINIMUM_GENERATIONS, patience=PATIENCE, tolerance=TOLERANCE):
        self.minimum_generations = minimum_generations
        self.patience = patience
        self.tolerance = tolerance
        self.best = None
        self.stable_generations = 0

    def observe(self, generation, candidates):
        feasible = [row for row in candidates if not row.get("constraints_violated", True)
                    and all(isinstance(row.get(key), (int, float)) and isfinite(row[key]) for key in OBJECTIVES)]
        if not feasible:
            self.stable_generations = 0
            return False
        current = tuple(max(row[key] for row in feasible) for key in OBJECTIVES)
        improved = self.best is None or any(value > best + self.tolerance for value, best in zip(current, self.best))
        # Keep the material-progress baseline so sub-tolerance gains accumulate.
        self.best = current if self.best is None else tuple(
            value if value > best + self.tolerance else best for value, best in zip(current, self.best))
        self.stable_generations = 0 if improved else self.stable_generations + 1
        return generation >= self.minimum_generations and self.stable_generations >= self.patience
