import pytest

from optimization.engine import GeneticDeploymentOptimizer


@pytest.mark.parametrize(
    "parameters",
    [
        {
            "population_size": 80,
            "generations": 60,
            "mutation_rate": 0.12,
            "crossover_rate": 0.8,
            "elitism_count": 4,
        }
    ],
)
def test_ga_returns_top_three_and_history(parameters):
    optimizer = GeneticDeploymentOptimizer(seed=7)

    officers = [
        {
            "id": 1,
            "badge_number": "OFC-001",
            "current_latitude": 10.72,
            "current_longitude": 122.56,
        },
        {
            "id": 2,
            "badge_number": "OFC-002",
            "current_latitude": 10.73,
            "current_longitude": 122.57,
        },
        {
            "id": 3,
            "badge_number": "OFC-003",
            "current_latitude": 10.71,
            "current_longitude": 122.55,
        },
    ]
    bottlenecks = [
        {
            "id": "B-001",
            "name": "Main Junction",
            "latitude": 10.7202,
            "longitude": 122.5621,
            "road_priority_weight": 1.4,
            "tsi": 0.25,
        },
        {
            "id": "B-002",
            "name": "Market Road",
            "latitude": 10.7212,
            "longitude": 122.5611,
            "road_priority_weight": 1.2,
            "tsi": 0.55,
        },
        {
            "id": "B-003",
            "name": "Bridge",
            "latitude": 10.7242,
            "longitude": 122.5591,
            "road_priority_weight": 1.6,
            "tsi": 0.35,
        },
    ]

    result = optimizer.run(officers=officers, bottlenecks=bottlenecks, parameters=parameters, weather_impact_factor=1.15)

    assert result.status == "completed"
    assert len(result.generation_fitness) == parameters["generations"]
    assert len(result.top_solutions) == 3
    assert result.best_fitness > 0
    assert all("assignments" in row for row in result.top_solutions)


def test_ga_never_keeps_a_bottleneck_over_its_staffing_cap():
    optimizer = GeneticDeploymentOptimizer(seed=11)
    officers = [{"id": index, "badge_number": f"OFC-{index:03d}", "current_latitude": 10.72, "current_longitude": 122.56} for index in range(1, 9)]
    bottlenecks = [
        {
            "id": "B-CAPPED",
            "name": "Capped Junction",
            "latitude": 10.72,
            "longitude": 122.56,
            "road_priority_weight": 2.0,
            "tsi": 0.9,
            "max_officers_allowed": 2,
        },
    ]

    result = optimizer.run(
        officers=officers,
        bottlenecks=bottlenecks,
        parameters={"population_size": 60, "generations": 50, "mutation_rate": 0.1, "crossover_rate": 0.8, "elitism_count": 3},
        weather_impact_factor=1.0,
    )

    for solution in result.top_solutions:
        assert len(solution["assignments"]) <= 2
