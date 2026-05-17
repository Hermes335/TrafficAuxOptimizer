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
    updateConfig,
    applyPreset,
    resetDefaults,
    selectedPreset,
    toRunParams,
    params,
    weightTotal,
    weightsValid,
  };
}
