import { useMemo, useState } from "react";
import type { OptimizationRunParams } from "../types/optimization";

const DEFAULTS = {
  populationSize: 200,
  generationLimit: 300,
  crossoverRate: 80,
  mutationRate: 10,
  elitismRate: 10,
  tsiWeight: 35,
  wifWeight: 25,
  rpwWeight: 25,
  resourceUtilizationWeight: 15,
};

type Preset = "normal" | "typhoon" | "special_event" | "balanced" | "custom";

const PRESETS: Record<string, typeof DEFAULTS> = {
  normal: { ...DEFAULTS },
  typhoon: {
    populationSize: 240, generationLimit: 350, crossoverRate: 78, mutationRate: 8,
    elitismRate: 12, tsiWeight: 30, wifWeight: 50, rpwWeight: 15, resourceUtilizationWeight: 5,
  },
  special_event: {
    populationSize: 180, generationLimit: 250, crossoverRate: 85, mutationRate: 12,
    elitismRate: 15, tsiWeight: 50, wifWeight: 15, rpwWeight: 25, resourceUtilizationWeight: 10,
  },
  balanced: {
    populationSize: 200, generationLimit: 300, crossoverRate: 80, mutationRate: 10,
    elitismRate: 10, tsiWeight: 25, wifWeight: 25, rpwWeight: 25, resourceUtilizationWeight: 25,
  },
};

export interface AutoWeightConditions {
  avgTsi: number;
  weatherImpactFactor: number;
  activeIncidentCount: number;
  criticalIncidentCount: number;
  resourceUtilization: number;
}

export interface AutoWeightSuggestion {
  tsiWeight: number;
  wifWeight: number;
  rpwWeight: number;
  resourceUtilizationWeight: number;
  conditions: AutoWeightConditions;
  reasons: string[];
}

/**
 * Compute auto-weight suggestion based on current traffic conditions.
 * Returns suggested weights (summing to 100) and the reasoning.
 */
export function computeAutoWeights(
  bottlenecks: Array<{ tsi?: number }>,
  weatherImpactFactor: number,
  incidents: Array<{ type?: string }>,
  resourceUtilization: number,
): AutoWeightSuggestion {
  const reasons: string[] = [];

  // Base weights (Normal preset)
  let tsi = 35;
  let wif = 25;
  let rpw = 25;
  let ru = 15;

  // Compute avg TSI
  const tsiValues = bottlenecks.map((b) => b.tsi ?? 0).filter((v) => v > 0);
  const avgTsi = tsiValues.length > 0 ? tsiValues.reduce((a, b) => a + b, 0) / tsiValues.length : 0;

  // High congestion → boost TSI
  if (avgTsi > 0.5) {
    tsi += 15;
    reasons.push(`High congestion (avg TSI ${Math.round(avgTsi * 100)}%) → TSI weight boosted`);
  } else if (avgTsi > 0.3) {
    tsi += 8;
    reasons.push(`Moderate congestion (avg TSI ${Math.round(avgTsi * 100)}%) → TSI weight slightly boosted`);
  }

  // Bad weather → boost WIF
  if (weatherImpactFactor > 1.4) {
    wif += 15;
    reasons.push(`Severe weather (WIF ${weatherImpactFactor.toFixed(1)}) → Weather weight boosted`);
  } else if (weatherImpactFactor > 1.15) {
    wif += 8;
    reasons.push(`Mild weather impact (WIF ${weatherImpactFactor.toFixed(1)}) → Weather weight slightly boosted`);
  }

  // Active incidents → boost RPW
  const criticalCount = incidents.filter((i) => i.type === "critical").length;
  const majorCount = incidents.filter((i) => i.type === "major").length;
  if (criticalCount > 0) {
    rpw += 15;
    reasons.push(`${criticalCount} critical incident(s) → Road Priority weight boosted`);
  } else if (majorCount > 0) {
    rpw += 8;
    reasons.push(`${majorCount} major incident(s) → Road Priority weight slightly boosted`);
  }

  // Low utilization → boost RU
  if (resourceUtilization < 40) {
    ru += 10;
    reasons.push(`Low resource utilization (${Math.round(resourceUtilization)}%) → Utilization weight boosted`);
  }

  // Normalize to 100%
  const total = tsi + wif + rpw + ru;
  const normalized = {
    tsiWeight: Math.round((tsi / total) * 100),
    wifWeight: Math.round((wif / total) * 100),
    rpwWeight: Math.round((rpw / total) * 100),
    resourceUtilizationWeight: 0, // fill remainder to ensure sum=100
  };
  normalized.resourceUtilizationWeight = 100 - normalized.tsiWeight - normalized.wifWeight - normalized.rpwWeight;

  if (reasons.length === 0) {
    reasons.push("Conditions are normal → using default weights");
  }

  return {
    ...normalized,
    conditions: {
      avgTsi,
      weatherImpactFactor,
      activeIncidentCount: incidents.length,
      criticalIncidentCount: criticalCount,
      resourceUtilization,
    },
    reasons,
  };
}

export function useOptimizationConfig() {
  const [config, setConfig] = useState({ ...DEFAULTS });
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const updateConfig = (patch: Partial<typeof DEFAULTS>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setSelectedPreset("custom");
  };

  const applyPreset = (preset: Preset) => {
    setSelectedPreset(preset);
    if (preset !== "custom" && PRESETS[preset]) {
      setConfig({ ...PRESETS[preset] });
    }
  };

  const resetDefaults = () => {
    setSelectedPreset(null);
    setConfig({ ...DEFAULTS });
  };

  const weightTotal = config.tsiWeight + config.wifWeight + config.rpwWeight + config.resourceUtilizationWeight;
  const weightsValid = weightTotal > 0;

  const toRunParams = (): OptimizationRunParams => ({
    population_size: config.populationSize,
    generations: config.generationLimit,
    mutation_rate: Number((config.mutationRate / 100).toFixed(2)),
    crossover_rate: Number((config.crossoverRate / 100).toFixed(2)),
    elitism_count: Math.max(1, Math.round((config.elitismRate / 100) * config.populationSize)),
    tsi_weight: Number((config.tsiWeight / 100).toFixed(2)),
    wif_weight: Number((config.wifWeight / 100).toFixed(2)),
    rpw_weight: Number((config.rpwWeight / 100).toFixed(2)),
    resource_utilization_weight: Number((config.resourceUtilizationWeight / 100).toFixed(2)),
    scenario: selectedPreset && selectedPreset !== "custom" ? selectedPreset : "",
  });

  const params = useMemo(() => toRunParams(), [config, selectedPreset]);

  return {
    config,
    setConfig,
    updateConfig,
    applyPreset,
    resetDefaults,
    selectedPreset,
    setSelectedPreset,
    toRunParams,
    params,
    weightTotal,
    weightsValid,
  };
}
