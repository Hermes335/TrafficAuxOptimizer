/** Only labels and set operations live here. The backend owns aliases and task preferences. */
export function officerSkillLabel(value: string): string {
  const labels: Record<string, string> = {
    traffic_control: "Traffic control",
    intersection_management: "Intersection management",
    school_crossing: "School crossing",
    incident_response: "Incident response",
    first_aid: "First aid",
  };
  return labels[value] ?? value;
}

export function uniqueOfficerSkills(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap(value => {
    const skill = value.trim();
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) return [];
    seen.add(key);
    return [skill];
  });
}

export function matchingOfficerSkills(skills: readonly string[], preferences: readonly string[]): string[] {
  const recorded = new Set(skills.map(value => value.toLowerCase()));
  return preferences.filter(value => recorded.has(value.toLowerCase()));
}
