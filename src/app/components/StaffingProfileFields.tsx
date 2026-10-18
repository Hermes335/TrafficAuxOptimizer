import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { StaffingProfile, StaffingPeriod } from "../services/backend";

const allDays = [0, 1, 2, 3, 4, 5, 6];
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function staffingProfile(value: Partial<StaffingProfile>): StaffingProfile {
  return {
    area_name: value.area_name ?? "", signal_status: value.signal_status ?? "unknown",
    min_officers_required: value.min_officers_required ?? 2,
    max_officers_allowed: value.max_officers_allowed ?? 5,
    staffing_periods: value.staffing_periods?.map(period => ({ ...period, days: [...(period.days ?? allDays)] })) ?? [],
  };
}

function minuteOfDay(value: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** Mirrors core/staffing.py and BottleneckSerializer without changing saved values. */
export function validateStaffingProfile(value: StaffingProfile): Record<string, string> {
  const errors: Record<string, string> = {};
  if (Array.from(value.area_name.trim()).length > 120) errors.area_name = "Use at most 120 characters.";
  if (!Number.isInteger(value.min_officers_required) || value.min_officers_required < 0) {
    errors.min_officers_required = "Enter a whole number of 0 or more.";
  }
  if (!Number.isInteger(value.max_officers_allowed) || value.max_officers_allowed < 0) {
    errors.max_officers_allowed = "Enter a whole number of 0 or more.";
  } else if (value.max_officers_allowed < value.min_officers_required) {
    errors.max_officers_allowed = "Maximum must be at least the normal minimum.";
  }
  if (!Array.isArray(value.staffing_periods)) return { ...errors, staffing_periods: "Provide a list of staffing periods." };
  if (value.staffing_periods.length > 32) errors.staffing_periods = "Use no more than 32 staffing periods.";

  const windows: { start: number; end: number; days: number[]; index: number }[] = [];
  value.staffing_periods.forEach((period, index) => {
    const key = `periods.${index}`;
    if (!period || typeof period !== "object") {
      errors.staffing_periods = "Each staffing period must include its times and officer requirement.";
      return;
    }
    const start = minuteOfDay(period.start);
    const end = minuteOfDay(period.end);
    if (start === null || start % 15 !== 0) errors[`${key}.start`] = "Choose a time in 15-minute steps.";
    if (end === null || end % 15 !== 0) errors[`${key}.end`] = "Choose a time in 15-minute steps.";
    if (start !== null && end !== null && start >= end) {
      errors[`${key}.end`] = "End must follow start on the same day. Split overnight periods.";
    }
    if (!Number.isInteger(period.required) || period.required < 0) {
      errors[`${key}.required`] = "Enter a whole number of 0 or more.";
    } else if (period.required > value.max_officers_allowed) {
      errors[`${key}.required`] = "Cannot exceed the maximum officers.";
    }
    const days = period.days === undefined ? allDays : period.days;
    const validDays = Array.isArray(days) && days.length > 0
      && days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
      && new Set(days).size === days.length;
    if (!validDays) errors[`${key}.days`] = "Select at least one day, without duplicates.";
    if (period.label !== undefined && (typeof period.label !== "string" || Array.from(period.label).length > 80)) {
      errors[`${key}.label`] = "Use at most 80 characters for the label.";
    }
    if (start !== null && end !== null && start < end && validDays) {
      for (const previous of windows) {
        if (start < previous.end && previous.start < end && days.some(day => previous.days.includes(day))) {
          errors[`${key}.start`] ??= `Overlaps period ${previous.index + 1} on a selected day.`;
          errors[`periods.${previous.index}.start`] ??= `Overlaps period ${index + 1} on a selected day.`;
        }
      }
      windows.push({ start, end, days, index });
    }
  });
  return errors;
}

function timeLabel(value: string): string {
  const minutes = minuteOfDay(value);
  if (minutes === null) return value || "Select time";
  if (minutes === 1440) return "12:00 AM (end of day)";
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

const timeOptions = Array.from({ length: 97 }, (_, index) => {
  const minutes = index * 15;
  const value = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { value, label: timeLabel(value) };
});

function daysLabel(days: number[] = allDays): string {
  if (days.length === 7 && allDays.every(day => days.includes(day))) return "Every day";
  if (days.length === 5 && [0, 1, 2, 3, 4].every(day => days.includes(day))) return "Mon–Fri";
  if (days.length === 2 && days.includes(5) && days.includes(6)) return "Sat–Sun";
  return days.map(day => dayNames[day]).filter(Boolean).join(", ") || "No days selected";
}

interface StaffingProfileFieldsProps {
  value: StaffingProfile;
  onChange: (value: StaffingProfile) => void;
  hideArea?: boolean;
  showValidation?: boolean;
}

export function StaffingProfileFields({ value, onChange, hideArea = false, showValidation = false }: StaffingProfileFieldsProps) {
  const id = useId();
  const [edited, setEdited] = useState(false);
  const [openPeriods, setOpenPeriods] = useState<number[]>([]);
  const invalidFocusFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (invalidFocusFrame.current !== null) window.cancelAnimationFrame(invalidFocusFrame.current);
  }, []);
  const errors = validateStaffingProfile(value);
  const invalidPeriods = value.staffing_periods.map((_, index) => index)
    .filter(index => Object.keys(errors).some(key => key.startsWith(`periods.${index}.`))).join(",");
  useEffect(() => {
    if (!showValidation || !invalidPeriods) return;
    const invalidIndexes = invalidPeriods.split(",").map(Number);
    setOpenPeriods(previous => invalidIndexes.every(index => previous.includes(index))
      ? previous : [...new Set([...previous, ...invalidIndexes])]);
  }, [showValidation, invalidPeriods]);
  const showErrors = edited || showValidation;
  const update = (changes: Partial<StaffingProfile>) => {
    setEdited(true);
    onChange({ ...value, ...changes });
  };
  const updatePeriod = (index: number, changes: Partial<StaffingPeriod>) => update({
    staffing_periods: value.staffing_periods.map((period, position) => position === index ? { ...period, ...changes } : period),
  });
  const fieldId = (key: string) => `${id}-${key.replace(/\./g, "-")}`;
  const errorId = (key: string) => `${fieldId(key)}-error`;
  const attributes = (key: string) => ({
    id: fieldId(key),
    "aria-invalid": showErrors && !!errors[key] ? true : undefined,
    "aria-describedby": showErrors && errors[key] ? errorId(key) : undefined,
  });
  const error = (key: string) => showErrors && errors[key]
    ? <p id={errorId(key)} className="mt-1 text-xs text-rose-700">{errors[key]}</p> : null;
  const inputClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 aria-[invalid=true]:border-rose-400";
  const countValue = (count: number) => Number.isFinite(count) ? count : "";
  const parseCount = (input: string) => input === "" ? Number.NaN : Number(input);

  return <fieldset onInvalidCapture={event => {
    event.preventDefault();
    setEdited(true);
    const field = event.target as HTMLElement;
    const card = field.closest<HTMLElement>("[data-staffing-period]");
    if (card) {
      const index = Number(card.dataset.staffingPeriod);
      setOpenPeriods(previous => previous.includes(index) ? previous : [...previous, index]);
    }
    if (invalidFocusFrame.current === null) {
      invalidFocusFrame.current = window.requestAnimationFrame(() => {
        invalidFocusFrame.current = null;
        if (field.isConnected) field.focus();
      });
    }
  }} className="min-w-0 space-y-4 rounded-xl border border-slate-200 p-3 sm:p-4">
    <legend className="px-1 text-sm font-semibold text-slate-900">Intersection staffing</legend>
    {!hideArea && <div>
      <label htmlFor={fieldId("area_name")} className="block text-sm font-medium text-slate-700">Area / group name <span className="font-normal text-slate-500">(optional)</span></label>
      <input {...attributes("area_name")} value={value.area_name} maxLength={120} onChange={event => update({ area_name: event.target.value })} placeholder="e.g. Prime State" className={inputClass} />
      {error("area_name")}
      <p className="mt-1 text-xs text-slate-500">Use the same area name to group nearby intersections.</p>
    </div>}
    <label className="block text-sm font-medium text-slate-700">Traffic lights
      <select value={value.signal_status} onChange={event => update({ signal_status: event.target.value as StaffingProfile["signal_status"] })} className={inputClass}>
        <option value="unknown">Unknown</option><option value="working">Working</option><option value="none">None</option><option value="out_of_order">Out of order</option>
      </select>
    </label>
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label htmlFor={fieldId("min_officers_required")} className="block text-sm font-medium text-slate-700">Normal minimum</label>
        <input {...attributes("min_officers_required")} type="number" min={0} step={1} required value={countValue(value.min_officers_required)} onChange={event => update({ min_officers_required: parseCount(event.target.value) })} className={inputClass} />
        {error("min_officers_required")}
      </div>
      <div>
        <label htmlFor={fieldId("max_officers_allowed")} className="block text-sm font-medium text-slate-700">Maximum officers</label>
        <input {...attributes("max_officers_allowed")} type="number" min={0} step={1} required value={countValue(value.max_officers_allowed)} onChange={event => update({ max_officers_allowed: parseCount(event.target.value) })} className={inputClass} />
        {error("max_officers_allowed")}
      </div>
    </div>
    <div className="space-y-2 text-xs text-slate-600">
      <p><strong className="font-medium text-slate-700">0 means no post is required.</strong> Staffing periods replace normal demand for their selected times.</p>
      <details>
        <summary className="w-fit cursor-pointer font-medium text-slate-700">How staffing is applied</summary>
        <p className="mt-2 leading-relaxed">Normal staffing can rise with congestion. Critical incidents can add staffing, including during a zero-officer period, up to the maximum. Give each intersection its own marker.</p>
      </details>
    </div>

    <div className="space-y-3 border-t border-slate-200 pt-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">Staffing periods <span className="ml-1 font-normal text-slate-500">({value.staffing_periods.length})</span></h4>
        <p className="mt-1 text-xs text-slate-500">Asia/Manila · 15-minute steps · no overlap on the same day.</p>
      </div>
      {!value.staffing_periods.length && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">No periods added. Normal staffing applies throughout the day.</p>}
      {error("staffing_periods")}
      {value.staffing_periods.map((period, index) => {
        const key = `periods.${index}`;
        const hasError = Object.keys(errors).some(name => name.startsWith(`${key}.`));
        const expanded = openPeriods.includes(index) || (showValidation && hasError);
        const days = period.days ?? allDays;
        const officers = Number.isFinite(period.required) ? `${period.required} ${period.required === 1 ? "officer" : "officers"}` : "Set officers";
        return <div key={index} data-staffing-period={index} className={`min-w-0 overflow-hidden rounded-xl border ${hasError ? "border-rose-300" : "border-slate-200"}`}>
          <button type="button" aria-expanded={expanded} aria-controls={fieldId(`${key}.content`)}
            onClick={() => setOpenPeriods(previous => expanded ? previous.filter(position => position !== index) : [...previous, index])}
            className="flex w-full items-start justify-between gap-3 bg-slate-50 p-3 text-left hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-amber-500">
            <span className="min-w-0 space-y-1">
              <span className="block break-words text-sm font-medium text-slate-900">{period.label?.trim() || `Period ${index + 1}`}</span>
              <span className="block text-xs leading-relaxed text-slate-600">{daysLabel(days)} · {timeLabel(period.start)}–{timeLabel(period.end)}</span>
              <span className={`block text-xs font-medium ${period.required === 0 ? "text-emerald-700" : "text-slate-700"}`}>{officers}{period.required === 0 ? " · no post required" : ""}</span>
              {hasError && <span className="block text-xs font-medium text-rose-700">Check this period’s settings</span>}
            </span>
            <ChevronDown aria-hidden="true" className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
          <div id={fieldId(`${key}.content`)} hidden={!expanded} className="space-y-3 border-t border-slate-200 p-3">
            <div>
              <label htmlFor={fieldId(`${key}.label`)} className="block text-xs font-medium text-slate-700">Label <span className="font-normal text-slate-500">(optional)</span></label>
              <input {...attributes(`${key}.label`)} aria-label={`Period ${index + 1} label`} value={period.label ?? ""} maxLength={80} onChange={event => updatePeriod(index, { label: event.target.value })} placeholder="Peak / quiet period" className={inputClass} />
              {error(`${key}.label`)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(["start", "end"] as const).map(boundary => <div key={boundary} className="min-w-0">
                <label htmlFor={fieldId(`${key}.${boundary}`)} className="block text-xs font-medium text-slate-700">{boundary === "start" ? "Start" : "End"}</label>
                <select {...attributes(`${key}.${boundary}`)} aria-label={`Period ${index + 1} ${boundary}`} value={period[boundary]} onChange={event => updatePeriod(index, { [boundary]: event.target.value })} className={inputClass}>
                  {!timeOptions.some(option => option.value === period[boundary] && (boundary === "end" || option.value !== "24:00")) && <option value={period[boundary]}>{period[boundary] || "Select time"}</option>}
                  {timeOptions.filter(option => boundary === "end" || option.value !== "24:00").map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {error(`${key}.${boundary}`)}
              </div>)}
            </div>
            <div className="max-w-48">
              <label htmlFor={fieldId(`${key}.required`)} className="block text-xs font-medium text-slate-700">Officers required</label>
              <input {...attributes(`${key}.required`)} aria-label={`Period ${index + 1} officers`} type="number" min={0} max={Number.isFinite(value.max_officers_allowed) ? value.max_officers_allowed : undefined} step={1} required value={countValue(period.required)} onChange={event => updatePeriod(index, { required: parseCount(event.target.value) })} className={inputClass} />
              {error(`${key}.required`)}
            </div>
            <fieldset aria-describedby={showErrors && errors[`${key}.days`] ? errorId(`${key}.days`) : undefined}>
              <legend className="mb-2 text-xs font-medium text-slate-700">Days</legend>
              <div className="flex flex-wrap gap-2">{dayNames.map((dayName, day) => <label key={day} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${days.includes(day) ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 text-slate-600"}`}>
                <input aria-label={`Period ${index + 1} ${dayName}`} type="checkbox" checked={days.includes(day)} aria-invalid={showErrors && !!errors[`${key}.days`] ? true : undefined} aria-describedby={showErrors && errors[`${key}.days`] ? errorId(`${key}.days`) : undefined} onChange={event => updatePeriod(index, { days: event.target.checked ? [...days, day].sort() : days.filter(value => value !== day) })} className="accent-amber-500" />{dayName}
              </label>)}</div>
              {error(`${key}.days`)}
            </fieldset>
            <button type="button" aria-label={`Remove period ${index + 1}`} onClick={() => {
              setOpenPeriods(previous => previous.filter(position => position !== index).map(position => position > index ? position - 1 : position));
              update({ staffing_periods: value.staffing_periods.filter((_, position) => position !== index) });
            }} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">
              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />Remove period
            </button>
          </div>
        </div>;
      })}
      <button type="button" disabled={value.staffing_periods.length >= 32} onClick={() => {
        setOpenPeriods(previous => [...previous, value.staffing_periods.length]);
        update({ staffing_periods: [...value.staffing_periods, { start: "06:00", end: "07:00", required: value.min_officers_required, label: "", days: [...allDays] }] });
      }} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
        <Plus aria-hidden="true" className="h-4 w-4" />Add staffing period
      </button>
    </div>
  </fieldset>;
}
