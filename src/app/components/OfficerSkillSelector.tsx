import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { fetchOfficerSkillPolicy, type OfficerSkillPolicy } from "../services/backend";
import { officerSkillLabel, uniqueOfficerSkills } from "../services/officerSkills";

interface OfficerSkillSelectorProps {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

export function OfficerSkillSelector({ value, onChange, disabled = false }: OfficerSkillSelectorProps) {
  const id = useId();
  const [policy, setPolicy] = useState<OfficerSkillPolicy | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    fetchOfficerSkillPolicy()
      .then(result => { if (active) setPolicy(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);
  const legacy = value.filter(skill => !policy?.skills.some(option => option.value === skill));
  return <fieldset disabled={disabled} aria-describedby={`${id}-help`} className="min-w-0 space-y-3">
    <legend className="text-sm font-medium text-slate-700">Skills <span className="font-normal text-slate-400">(optional)</span></legend>
    <p id={`${id}-help`} className="text-xs leading-relaxed text-slate-500">Select recorded skills. Matching skills are a deployment preference; officers without a match remain eligible.</p>
    {policy && <div className="grid gap-2">
      {policy.skills.map(option => <label key={option.value} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 has-[:checked]:border-amber-400 has-[:checked]:bg-amber-50">
        <input type="checkbox" value={option.value} checked={value.includes(option.value)}
          onChange={event => onChange(event.target.checked ? uniqueOfficerSkills([...value, option.value]) : value.filter(skill => skill !== option.value))}
          className="h-4 w-4 shrink-0 accent-amber-500" />
        <span className="min-w-0 break-words">{option.label}</span>
      </label>)}
    </div>}
    {!policy && !error && <p role="status" className="text-xs text-slate-500">Loading skill choices…</p>}
    {error && <div role="status" className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
      <p>Skill choices are unavailable. Existing skills are retained; other officer details can still be saved.</p>
      <button type="button" onClick={() => setAttempt(current => current + 1)} className="min-h-9 rounded border border-amber-300 px-3 font-medium">Retry skill choices</button>
    </div>}
    {!!legacy.length && <div className="space-y-2">
      <p className="text-xs font-medium text-slate-600">{policy ? "Other recorded skills" : "Recorded skills"}</p>
      <div className="flex flex-wrap gap-2">
        {legacy.map(skill => <span key={skill} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 pl-2 text-xs text-slate-700">
          <span className="min-w-0 break-words">{officerSkillLabel(skill)}</span>
          <button type="button" aria-label={`Remove skill ${skill}`} onClick={() => onChange(value.filter(current => current !== skill))} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-slate-200">
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </span>)}
      </div>
      {policy && <p className="text-xs text-slate-500">Existing labels are preserved. Only recognized skills affect matching.</p>}
    </div>}
  </fieldset>;
}
