import { useMemo } from "react";
import { operationalDate, operationalTime } from "../../services/operationalTime";
import type { BottleneckOption, DashboardOfficerRecord, DeploymentScheduleItem, OfficerTimeBlock } from "../../services/backend";

interface Props {
  blocks?:OfficerTimeBlock[];
  deployments: DeploymentScheduleItem[];
  viewMode: "officer" | "bottleneck";
  day?: string;
  shift?: string;
  bottlenecks?: BottleneckOption[];
  officers?: DashboardOfficerRecord[];
  onSelect?: (assignment:DeploymentScheduleItem)=>void;
}

export function timelinePosition(start:string, end:string, rangeStart:number, rangeEnd:number) {
  const left = Math.max(rangeStart, new Date(start).getTime());
  const right = Math.min(rangeEnd, new Date(end).getTime());
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return null;
  return {left:`${100*(left-rangeStart)/(rangeEnd-rangeStart)}%`, width:`${100*(right-left)/(rangeEnd-rangeStart)}%`};
}

export function GanttTimeline({deployments, viewMode, day=operationalDate(), shift="all", bottlenecks=[], officers=[], blocks=[], onSelect}:Props) {
  const startHour = shift === "afternoon" ? 14 : 6;
  const endHour = shift === "morning" ? 14 : 22;
  const rangeStart = new Date(`${day}T${String(startHour).padStart(2,"0")}:00:00+08:00`).getTime();
  const rangeEnd = new Date(`${day}T${endHour}:00:00+08:00`).getTime();
  const hours = Array.from({length:endHour-startHour+1},(_,i)=>i+startHour);
  const rows = useMemo(()=>{
    const grouped = new Map<string,{label:string;area:string;items:DeploymentScheduleItem[];node?:BottleneckOption}>();
    if (viewMode === "bottleneck") for (const node of bottlenecks) grouped.set(node.id,{label:node.name,area:node.area_name ?? "",items:[],node});
    if (viewMode === "officer") for (const officer of officers.filter(o=>(shift === "all" || o.shift === shift) && ["available","deployed"].includes(o.status))) {
      grouped.set(officer.badge_number,{label:`${officer.badge_number} · ${officer.name}`,area:officer.shift,items:[]});
    }
    for (const dep of deployments) {
      if (!["assigned","completed"].includes(dep.status) || !timelinePosition(dep.start_time,dep.end_time,rangeStart,rangeEnd)) continue;
      const key = viewMode === "officer" ? dep.officer : dep.bottleneck;
      const row = grouped.get(key) ?? {label:viewMode === "officer" ? `${dep.officer} · ${dep.officer_name}` : dep.bottleneck_name ?? dep.bottleneck,area:dep.area_name ?? "",items:[]};
      row.items.push(dep); grouped.set(key,row);
    }
    return [...grouped.entries()].map(([id,row])=>{
      const ends:number[]=[];
      const bars = row.items.sort((a,b)=>Date.parse(a.start_time)-Date.parse(b.start_time)).map(item=>{
        let lane=ends.findIndex(end=>end<=Date.parse(item.start_time));
        if(lane<0) lane=ends.length;
        ends[lane]=Date.parse(item.end_time);
        return {item,lane};
      });
      return {id,...row,bars,lanes:Math.max(1,ends.length)};
    }).sort((a,b)=>a.area.localeCompare(b.area)||a.label.localeCompare(b.label));
  },[deployments,viewMode,bottlenecks,officers,shift,rangeStart,rangeEnd]);
  const now = Date.now();
  return <section aria-label="Deployment Gantt timeline" className="overflow-hidden rounded-xl border bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <h3 className="font-semibold">Deployment Gantt by {viewMode === "officer" ? "Officer" : "Intersection"}</h3>
      <p className="text-xs text-slate-500">Asia/Manila · {onSelect ? "Select a bar to edit its time or location" : "Assignment times"}</p>
    </div>
    <div className="max-h-[65vh] overflow-auto" tabIndex={0} aria-label="Scroll deployment timeline">
      <div style={{minWidth:240+(endHour-startHour)*76}}>
        <div className="sticky top-0 z-20 flex h-11 border-b bg-slate-50">
          <div className="sticky left-0 z-20 w-60 shrink-0 border-r bg-slate-50 px-4 py-3 text-xs font-semibold">{viewMode === "officer" ? "Officer / shift" : "Area / intersection"}</div>
          <div className="relative flex-1">{hours.map((hour,i)=><span key={hour} className="absolute top-3 text-xs text-slate-600" style={{left:`${100*i/(hours.length-1)}%`,transform:i===hours.length-1?"translateX(-100%)":i?"translateX(-50%)":"none"}}>{String(hour).padStart(2,"0")}:00</span>)}</div>
        </div>
        {!rows.length && <p className="p-8 text-sm text-slate-500">No assignments or locations match this view. Create an assignment or publish a recommendation.</p>}
        {rows.map(row=><div key={row.id} className="flex border-b last:border-b-0" style={{minHeight:row.lanes*36+36}}>
          <div className="sticky left-0 z-10 flex w-60 shrink-0 flex-col justify-center border-r bg-white px-4 py-2">
            <span className="text-xs text-slate-500">{row.area}</span><span className="truncate text-sm font-medium" title={row.label}>{row.label}</span>
          </div>
          <div className="relative flex-1 bg-slate-50/40">
            {viewMode==="officer"&&<div className="absolute inset-0 bg-slate-50" title="Unassigned time outside recorded assignments, breaks and travel"/>}
            {viewMode==="officer"&&blocks.filter(b=>b.badge_number===row.id).map(b=>{const pos=timelinePosition(b.start_time,b.end_time,rangeStart,rangeEnd);return pos&&<div key={b.id} style={{...pos,top:6}} title={`${b.kind}: ${operationalTime(b.start_time)}–${operationalTime(b.end_time)} ${b.note}`} className={`absolute z-10 h-8 truncate rounded border px-2 py-1 text-xs ${b.kind==="break"?"border-purple-300 bg-purple-100 text-purple-900":"border-orange-300 bg-orange-100 text-orange-900"}`}>{b.kind==="break"?"Break":"Travel"}</div>;})}
            {hours.slice(0,-1).map((hour,i)=><div key={hour} className="pointer-events-none absolute inset-y-0 border-l border-slate-100" style={{left:`${100*i/(hours.length-1)}%`}}/>)}
            {row.node?.staffing_windows?.map(window=>{
              const position=timelinePosition(window.start_time,window.end_time,rangeStart,rangeEnd);
              return position && <div key={window.start_time} style={{...position,bottom:0}} className={`absolute h-6 truncate border-r px-1 py-1 text-[10px] ${window.required===0?"bg-emerald-50 text-emerald-800":"bg-slate-100 text-slate-600"}`} title={`${operationalTime(window.start_time)}–${operationalTime(window.end_time)}: ${window.required} required · ${window.reason}`}>{window.required===0?"0 required · free":"Required: "+window.required}</div>;
            })}
            {!row.bars.length && <span className="absolute left-3 top-3 text-xs text-slate-400">{row.node?.staffing_windows?.every(w=>w.required===0) ? "No officers required" : "Unassigned"}</span>}
            {row.bars.map(({item,lane})=>{
              const position=timelinePosition(item.start_time,item.end_time,rangeStart,rangeEnd)!;
              const label=viewMode === "officer" ? item.bottleneck_name ?? item.bottleneck : `${item.officer} · ${item.officer_name}`;
              const description=`${item.officer_name} at ${item.bottleneck_name ?? item.bottleneck}, ${operationalTime(item.start_time)}–${operationalTime(item.end_time)}, ${item.status}`;
              return <button type="button" key={item.id} data-assignment-id={item.id} aria-label={description} title={description}
                disabled={!onSelect || item.status!=="assigned" || Date.parse(item.end_time)<=now}
                onClick={()=>onSelect?.(item)} style={{...position,top:6+lane*36}}
                className={`absolute h-8 overflow-hidden rounded border px-2 text-left text-xs focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 ${item.status === "completed" ? "border-slate-300 bg-slate-200 text-slate-700" : "border-blue-300 bg-blue-100 text-blue-900 hover:bg-blue-200"}`}>
                <span className="block truncate font-medium">{label}</span><span className="block truncate text-[10px]">{operationalTime(item.start_time)}–{operationalTime(item.end_time)}</span>
              </button>;
            })}
            {now>=rangeStart && now<rangeEnd && <div aria-label="Current Manila time" className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-red-400" style={{left:`${100*(now-rangeStart)/(rangeEnd-rangeStart)}%`}}/>}
          </div>
        </div>)}
      </div>
    </div>
    <div className="flex flex-wrap gap-4 border-t px-4 py-2 text-xs text-slate-600"><span>Blue: scheduled</span><span>Gray: completed / unassigned</span><span>Purple: break</span><span>Orange: reserved travel</span><span>Green: zero staffing required</span></div>
  </section>;
}
