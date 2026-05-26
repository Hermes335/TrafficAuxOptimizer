  Recommended Baselines

  1. Random Assignment (Lower Bound)

  Randomly assign officers to bottlenecks. This establishes the floor — anything below this means
  the system is broken. Run 30 random seeds and average.

  2. Greedy Heuristic (Practical Baseline)

  Sort bottlenecks by TSI descending, assign officers one by one to the highest-TSI uncovered
  bottleneck. Simple, deterministic, and represents what a naive algorithm would do.

  3. Manual ICTTMO Deployment (Real-World Baseline)

  If you can get the actual shift schedules from ICTTMO, use those as the "human expert" baseline.
  This is the most compelling comparison because it's what the system is replacing.

  4. Single-Objective GA (Ablation Study)

  Run the same GA but with only one objective (coverage only, or response time only). This shows
  the value of multi-objective optimization.

  Want me to implement all four baselines as a management command that runs them alongside NSGA-II
  and produces a comparison table?