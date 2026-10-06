import type { StaffingProfile, StaffingPeriod } from "../services/backend";

export function staffingProfile(value: Partial<StaffingProfile>): StaffingProfile {
  return {area_name:value.area_name ?? "", signal_status:value.signal_status ?? "unknown",
    min_officers_required:value.min_officers_required ?? 2, max_officers_allowed:value.max_officers_allowed ?? 5,
    staffing_periods:value.staffing_periods?.map(p => ({...p, days:[...(p.days ?? [0,1,2,3,4,5,6])]})) ?? []};
}

export function StaffingProfileFields({value, onChange}: {value:StaffingProfile; onChange:(value:StaffingProfile)=>void}) {
  const updatePeriod = (index:number, changes:Partial<StaffingPeriod>) => onChange({...value,
    staffing_periods:value.staffing_periods.map((period,i) => i === index ? {...period,...changes} : period)});
  const inputClass = "mt-1 w-full rounded border px-2 py-1.5 text-sm";
  return <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
    <legend className="px-1 text-sm font-semibold">Intersection staffing</legend>
    <label className="block text-xs">Area / group name
      <input value={value.area_name} maxLength={120} onChange={e=>onChange({...value,area_name:e.target.value})} placeholder="e.g. Prime State" className={inputClass}/>
    </label>
    <p className="text-xs text-slate-500">Give each intersection its own marker. Use the same area name to group nearby intersections.</p>
    <label className="block text-xs">Traffic lights
      <select value={value.signal_status} onChange={e=>onChange({...value,signal_status:e.target.value as StaffingProfile["signal_status"]})} className={inputClass}>
        <option value="unknown">Unknown</option><option value="working">Working</option><option value="none">None</option><option value="out_of_order">Out of order</option>
      </select>
    </label>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs">Normal minimum<input type="number" min={0} step={1} required value={value.min_officers_required} onChange={e=>onChange({...value,min_officers_required:Number(e.target.value)})} className={inputClass}/></label>
      <label className="text-xs">Maximum officers<input type="number" min={0} step={1} required value={value.max_officers_allowed} onChange={e=>onChange({...value,max_officers_allowed:Number(e.target.value)})} className={inputClass}/></label>
    </div>
    <p className="text-xs text-slate-500">Set staffing for this intersection's layout and traffic lights. Normal staffing can rise with congestion. Periods below replace normal demand; zero means no post is required. Critical incidents can add staffing within the maximum.</p>
    {value.staffing_periods.map((period,index)=><div key={index} className="space-y-2 rounded border bg-slate-50 p-2">
      <div className="flex items-center gap-2"><input aria-label={`Period ${index+1} label`} value={period.label ?? ""} maxLength={80} onChange={e=>updatePeriod(index,{label:e.target.value})} placeholder="Peak / quiet period" className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"/>
        <button type="button" aria-label={`Remove period ${index+1}`} onClick={()=>onChange({...value,staffing_periods:value.staffing_periods.filter((_,i)=>i!==index)})} className="text-xs text-red-700">Remove</button></div>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs">Start<input aria-label={`Period ${index+1} start`} type="time" step={900} value={period.start} onChange={e=>updatePeriod(index,{start:e.target.value})} className={inputClass}/></label>
        <label className="text-xs">End<input aria-label={`Period ${index+1} end`} type="time" step={900} value={period.end} onChange={e=>updatePeriod(index,{end:e.target.value})} className={inputClass}/></label>
        <label className="text-xs">Officers<input aria-label={`Period ${index+1} officers`} type="number" min={0} max={value.max_officers_allowed} step={1} value={period.required} onChange={e=>updatePeriod(index,{required:Number(e.target.value)})} className={inputClass}/></label>
      </div>
      <div className="flex flex-wrap gap-2">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((label,day)=><label key={day} className="flex items-center gap-1 text-xs"><input type="checkbox" aria-label={`Period ${index+1} ${label}`} checked={(period.days ?? [0,1,2,3,4,5,6]).includes(day)} onChange={e=>updatePeriod(index,{days:e.target.checked ? [...(period.days ?? []),day].sort() : (period.days ?? []).filter(d=>d!==day)})}/>{label}</label>)}</div>
    </div>)}
    <button type="button" disabled={value.staffing_periods.length >= 32} onClick={()=>onChange({...value,staffing_periods:[...value.staffing_periods,{start:"06:00",end:"07:00",required:value.min_officers_required,label:"",days:[0,1,2,3,4,5,6]}]})} className="rounded border bg-white px-3 py-1.5 text-xs font-medium">Add staffing period</button>
    <p className="text-xs text-slate-500">Asia/Manila · 15-minute steps · periods on the same day cannot overlap.</p>
  </fieldset>;
}
