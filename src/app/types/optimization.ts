export interface ConvergencePoint {
  id: string;
  generation: number;
  bestFitness: number;
  avgFitness: number;
}

export function upsertConvergencePoint(prev: ConvergencePoint[], next: ConvergencePoint): ConvergencePoint[] {
  const index = prev.findIndex((p) => p.generation === next.generation);
  if (index >= 0) {
    const copy = [...prev];
    copy[index] = next;
    return copy;
  }
  return [...prev, next].slice(-200);
}

export function getRunStatusToneClass(status: string | undefined): string {
  if (status === "completed") return "bg-green-100 text-green-700";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "cancelled") return "bg-gray-100 text-gray-700";
  return "bg-yellow-100 text-yellow-700";
}

export interface OptimizationRunParams {
  population_size: number;
  generations: number;
  mutation_rate: number;
  crossover_rate: number;
  elitism_count: number;
  tsi_weight: number;
  wif_weight: number;
  rpw_weight: number;
  resource_utilization_weight: number;
}

export function encodeRunParams(params: OptimizationRunParams): string {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  ).toString();
}

export function decodeRunParams(search: string): OptimizationRunParams {
  const q = new URLSearchParams(search);
  return {
    population_size: Number(q.get("population_size") || 200),
    generations: Number(q.get("generations") || 300),
    mutation_rate: Number(q.get("mutation_rate") || 0.1),
    crossover_rate: Number(q.get("crossover_rate") || 0.8),
    elitism_count: Number(q.get("elitism_count") || 5),
    tsi_weight: Number(q.get("tsi_weight") || 0.35),
    wif_weight: Number(q.get("wif_weight") || 0.25),
    rpw_weight: Number(q.get("rpw_weight") || 0.25),
    resource_utilization_weight: Number(q.get("resource_utilization_weight") || 0.15),
  };
}
