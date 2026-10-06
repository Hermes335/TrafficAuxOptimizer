import { useEffect, useState } from "react";
import { deploymentOperation, type BottleneckOption, type DashboardOfficerRecord, type FieldObservation, type OfficerTimeBlock, type ScheduleReview } from "../../services/backend";
import { operationalTime } from "../../services/operationalTime";
import { inArea } from "../../components/AreaFilter";

export function OperationsPanel({day,shift,area,nodes,officers,canManage,refreshKey,onBlocks,onChanged}:{day:string;shift:string;area:string;nodes:BottleneckOption[];officers:DashboardOfficerRecord[];canManage:boolean;refreshKey:number;onBlocks:(rows:OfficerTimeBlock[])=>void;onChanged:()=>void}) {
  const [review,setReview]=useState<ScheduleReview|null>(null),[blocks,setBlocks]=useState<OfficerTimeBlock[]>([]),[observations,setObservations]=useState<FieldObservation[]>([]);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  useEffect(()=>{let active=true;setReview(null);setError(null);setBlocks([]);setObservations([]);onBlocks([]);
    Promise.all([deploymentOperation<ScheduleReview>(`review/?date=${day}&shift=${shift}`),deploymentOperation<OfficerTimeBlock[]>(`time-blocks/?date=${day}&shift=${shift}`),deploymentOperation<FieldObservation[]>(`observations/?date=${day}`)])
    .then(([r,b,o])=>{if(active){setReview(r);setBlocks(b);onBlocks(b);setObservations(o);}}).catch(e=>{if(active){setError(e.message);onBlocks([]);}});
    return()=>{active=false;};
  },[day,shift,refreshKey,onBlocks]);
  const visibleNodes=nodes.filter(n=>inArea(n,area));
  const issues=review?.issues.filter(i=>!area||visibleNodes.some(n=>n.id===i.bottleneck))??[];
  const visibleObservations=observations.filter(o=>inArea(o,area));
  async function save(path:string,payload:unknown,form:HTMLFormElement){setBusy(true);setError(null);setNotice("");try{await deploymentOperation(path,payload);form.reset();setNotice("Saved.");onChanged();}catch(e){setError(e instanceof Error?e.message:"Unable to save.");}finally{setBusy(false);}}
  function exportFeedback(){const columns=["observed_at","area_name","bottleneck_name","required_officers","scheduled_officers","actual_officers","traffic","note"] as const;
    const cell=(value:unknown)=>`"${String(value??"").replace(/^[=+@\-]/,"'$&").replace(/"/g,'""')}"`;
    const csv=[columns.join(","),...visibleObservations.map(o=>columns.map(k=>cell(o[k])).join(","))].join("\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`field-feedback-${day}.csv`;a.click();URL.revokeObjectURL(url);}
  return <section className="space-y-2 border-b bg-white px-6 py-3" aria-label="Schedule review and field feedback">
    {error&&<p role="alert" className="text-sm text-red-700">Operational checks unavailable or action failed: {error}</p>}
    {review&&(issues.length?<details className="rounded border border-amber-300 bg-amber-50 p-3"><summary className="cursor-pointer text-sm font-semibold">Schedule needs review · {issues.length} issues{area?" in selected area":""}</summary><p className="my-2 text-xs">Review affected assignments and rerun optimization or edit the schedule. No changes are applied automatically.</p><ul className="space-y-1 text-xs">{issues.map((i,index)=><li key={index}><strong>{nodes.find(n=>n.id===i.bottleneck)?.name??i.bottleneck}</strong>: {i.reason}{i.assignment_ids.length>0?` (assignments ${i.assignment_ids.join(", ")})`:""}</li>)}</ul></details>:<p className="text-xs text-emerald-800">{review.scope}: no issues detected{area?" in selected area":""}.</p>)}
    <details className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Breaks and travel reservations · {blocks.length}</summary>
      <p className="my-2 text-xs text-slate-600">Reserved time excludes the officer from optimization and assignments. Shorten overlapping assignments first. Other gaps mean unassigned; travel is not inferred from a gap.</p>
      {canManage&&<form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void save("time-blocks/",{officer:Number(d.get("officer")),kind:d.get("kind"),start_time:`${day}T${d.get("start")}:00+08:00`,end_time:`${day}T${d.get("end")}:00+08:00`,note:d.get("note")},f);}}><fieldset disabled={busy} className="contents">
        <label>Officer<select name="officer" required className="block rounded border p-2"><option value="">Choose officer</option>{officers.filter(o=>shift==="all"||o.shift===shift).map(o=><option key={o.id} value={o.id}>{o.badge_number} · {o.name}</option>)}</select></label>
        <label>Reservation<select name="kind" className="block rounded border p-2"><option value="break">Break</option><option value="travel">Travel</option></select></label>
        <label>Starts<input name="start" type="time" required className="block rounded border p-2"/></label><label>Ends<input name="end" type="time" required className="block rounded border p-2"/></label><label>Note<input name="note" maxLength={300} placeholder="e.g. travel to next post" className="block rounded border p-2"/></label><button className="rounded bg-yellow-400 p-2">Reserve time</button>
      </fieldset></form>}
      <ul className="mt-2 space-y-1 text-xs">{blocks.map(b=><li key={b.id}>{b.badge_number} · {b.kind} · {operationalTime(b.start_time)}–{operationalTime(b.end_time)} · {b.note}{canManage&&Date.parse(b.start_time)>Date.now()&&<button disabled={busy} className="ml-2 text-red-700 underline" onClick={async()=>{setBusy(true);try{await deploymentOperation(`time-blocks/?id=${b.id}`,undefined,"DELETE");onChanged();}catch(e){setError(e instanceof Error?e.message:"Unable to remove.");}finally{setBusy(false);}}}>Remove reservation</button>}</li>)}</ul>
    </details>
    <details className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Field observations · {visibleObservations.length}</summary>
      <p className="my-2 text-xs text-slate-600">Compare observed staffing and traffic with the schedule. Requirements use the current profile at the observation time; late entries are not a reconstruction of historical traffic. Feedback does not change staffing automatically.</p>
      {canManage&&<form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void save("observations/",{bottleneck:d.get("node"),observed_at:`${day}T${d.get("at")}:00+08:00`,actual_officers:Number(d.get("actual")),traffic:d.get("traffic"),note:d.get("note")},f);}}><fieldset disabled={busy} className="contents">
        <label>Observed intersection<select name="node" required className="block rounded border p-2"><option value="">Choose intersection</option>{visibleNodes.map(n=><option key={n.id} value={n.id}>{n.area_name?n.area_name+" / ":""}{n.name}</option>)}</select></label>
        <label>Observed time<input name="at" type="time" required className="block rounded border p-2"/></label><label>Officers present<input name="actual" type="number" min={0} max={1000} required className="block w-28 rounded border p-2"/></label><label>Observed traffic<select name="traffic" className="block rounded border p-2">{["free","moderate","heavy","critical"].map(t=><option key={t}>{t}</option>)}</select></label><label>Observation note<input name="note" maxLength={1000} className="block rounded border p-2"/></label><button className="rounded bg-yellow-400 p-2">Save observation</button>
      </fieldset></form>}
      <button disabled={!visibleObservations.length} onClick={exportFeedback} className="my-2 rounded border px-2 py-1 text-xs">Export field feedback CSV</button>
      <div className="max-h-60 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{["Time / area / intersection","Required*","Scheduled","Present","Traffic / note"].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{visibleObservations.map(o=><tr key={o.id} className="border-t"><td className="p-2">{operationalTime(o.observed_at)} · {o.area_name} / {o.bottleneck_name}</td><td>{o.required_officers}</td><td>{o.scheduled_officers}</td><td className={o.actual_officers<o.required_officers?"text-red-700":""}>{o.actual_officers}</td><td>{o.traffic} · {o.note}</td></tr>)}</tbody></table></div>
    </details>{notice&&<p role="status" className="text-xs text-emerald-800">{notice}</p>}
  </section>;
}
