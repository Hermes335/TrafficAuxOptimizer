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
  const ru = 15;

  // Compute avg TSI
  const tsiValues = bottlenecks.flatMap(b => b.tsi == null ? [] : [b.tsi]);
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

  // Available reserves do not imply unmet staffing demand.
  if (resourceUtilization < 40) {
    reasons.push(`Roster utilization ${Math.round(resourceUtilization)}%: staffing targets determine deployment; surplus officers stay available`);
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
