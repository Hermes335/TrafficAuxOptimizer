import pytest

from optimization.convergence import ConvergenceTracker, OBJECTIVES


def candidate(**changes):
    return {**dict.fromkeys(OBJECTIVES, 80.0), "constraints_violated": False, **changes}


def test_flat_search_waits_for_warmup():
    tracker = ConvergenceTracker()
    for generation in range(1, 50):
        assert not tracker.observe(generation, [candidate()])
    assert tracker.observe(50, [candidate()])


@pytest.mark.parametrize("objective", OBJECTIVES)
def test_every_objective_and_weighted_fitness_can_keep_search_running(objective):
    tracker = ConvergenceTracker()
    for generation in range(1, 81):
        assert not tracker.observe(generation, [candidate(**{objective: 80 + generation / 100})])


def test_material_gain_restarts_patience():
    tracker = ConvergenceTracker()
    for generation in range(1, 65):
        assert not tracker.observe(generation, [candidate(staffing_efficiency=81 if generation >= 45 else 80)])
    assert tracker.observe(65, [candidate(staffing_efficiency=81)])


def test_checks_candidates_beyond_the_first_ten():
    tracker = ConvergenceTracker()
    for generation in range(1, 71):
        population = [candidate() for _ in range(10)] + [candidate(road_priority_coverage=80 + generation / 100)]
        assert not tracker.observe(generation, population)


@pytest.mark.parametrize("population", [[], [candidate(constraints_violated=True)], [candidate(fitness=float("nan"))]])
def test_missing_or_infeasible_scores_cannot_claim_stability(population):
    tracker = ConvergenceTracker()
    for generation in range(1, 81):
        assert not tracker.observe(generation, population)


def test_small_improvements_accumulate_against_material_baseline():
    tracker = ConvergenceTracker(tolerance=0.01)
    for generation in range(1, 81):
        assert not tracker.observe(generation, [candidate(fitness=80 + generation / 1000)])
