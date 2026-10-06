import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { StaffingProfileFields, staffingProfile } from "../../components/StaffingProfileFields";
import { saveDeploymentAssignment, updateDashboardBottleneck, type BottleneckOption, type DashboardOfficerRecord,
  type DeploymentAssignmentPayload, type DeploymentScheduleItem } from "../../services/backend";

const inputClass="w-full rounded border px-3 py-2 text-sm";
function localTime(value:string) {
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Manila",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
}

export function AssignmentEditor({assignment, day, initialShift, officers, nodes, onClose, onSaved}:{
  assignment:DeploymentScheduleItem|null;day:string;initialShift:string;officers:DashboardOfficerRecord[];nodes:BottleneckOption[];onClose:()=>void;onSaved:()=>Promise<void>;
}) {
  const [shift,setShift]=useState<"morning"|"afternoon">((assignment?.shift ?? (initialShift === "morning" ? "morning":"afternoon")) as "morning"|"afternoon");
  const [officer,setOfficer]=useState(String(assignment?.officer_id ?? officers.find(o=>o.badge_number===assignment?.officer)?.id ?? ""));
  const [node,setNode]=useState(assignment?.bottleneck ?? "");
  const [start,setStart]=useState(assignment ? localTime(new Date(Math.max(Date.parse(assignment.start_time),Math.ceil(Date.now()/60000)*60000)).toISOString()) : shift === "morning"?"06:00":"14:00");
  const [end,setEnd]=useState(assignment ? localTime(assignment.end_time) : shift === "morning"?"14:00":"22:00");
  const [kind,setKind]=useState<DeploymentAssignmentPayload["assignment_type"]>((assignment?.assignment_type ?? "static") as DeploymentAssignmentPayload["assignment_type"]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const submit=async(cancel=false)=>{
    setBusy(true);setError(null);
    try {
      await saveDeploymentAssignment({officer:Number(officer),bottleneck:node,shift,
        start_time:`${day}T${start}:00+08:00`,end_time:`${day}T${end}:00+08:00`,assignment_type:kind,
        status:cancel?"cancelled":"assigned",expected_updated_at:assignment?.updated_at,override_reason:reason},assignment?.id);
      await onSaved();onClose();
    } catch(e) {setError(e instanceof Error?e.message:"Unable to save assignment.");} finally {setBusy(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto">
    <DialogTitle>{assignment?"Edit assignment":"Add timed assignment"}</DialogTitle><DialogDescription>Set the officer, intersection and time window for {day} in Asia/Manila. Overlaps, shift limits and location capacity are checked before saving.</DialogDescription>
    <form onSubmit={e=>{e.preventDefault();void submit();}} className="space-y-3">
      <label className="grid gap-1 text-sm">Shift<select disabled={!!assignment||busy} value={shift} onChange={e=>{const value=e.target.value as typeof shift;setShift(value);setOfficer("");setStart(value==="morning"?"06:00":"14:00");setEnd(value==="morning"?"14:00":"22:00");}} className={inputClass}><option value="morning">Morning · 06:00–14:00</option><option value="afternoon">Afternoon · 14:00–22:00</option></select></label>
      <label className="grid gap-1 text-sm">Officer<select required disabled={busy} value={officer} onChange={e=>setOfficer(e.target.value)} className={inputClass}><option value="">Select officer</option>{officers.filter(o=>o.shift===shift&&["available","deployed"].includes(o.status)).map(o=><option key={o.id} value={o.id}>{o.badge_number} · {o.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Intersection<select required disabled={busy} value={node} onChange={e=>setNode(e.target.value)} className={inputClass}><option value="">Select intersection</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.area_name ? n.area_name+" / ":""}{n.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm">Start time<input type="time" required disabled={busy} value={start} onChange={e=>setStart(e.target.value)} className={inputClass}/></label><label className="grid gap-1 text-sm">End time<input type="time" required disabled={busy} value={end} onChange={e=>setEnd(e.target.value)} className={inputClass}/></label></div>
      <label className="grid gap-1 text-sm">Assignment type<select disabled={busy} value={kind} onChange={e=>setKind(e.target.value as typeof kind)} className={inputClass}><option value="static">Static post</option><option value="mobile">Mobile patrol</option><option value="response">Rapid response</option></select></label>
      <label className="grid gap-1 text-sm">Override reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} disabled={busy} className={inputClass} placeholder="Required when adding excess staffing or reducing staffing below the requirement."/></label>
      {assignment?.override_reason&&<p className="text-xs text-slate-500">Previous reason: {assignment.override_reason}</p>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className="rounded bg-yellow-400 px-4 py-2 text-sm font-medium">{busy?"Saving…":"Save assignment"}</button><button type="button" disabled={busy} onClick={onClose} className="rounded border px-4 py-2 text-sm">Close</button>{assignment&&<button type="button" disabled={busy} onClick={()=>void submit(true)} className="rounded border border-red-200 px-4 py-2 text-sm text-red-700">End / cancel assignment</button>}</div>
    </form>
  </DialogContent></Dialog>;
}

export function StaffingEditor({nodes,onClose,onSaved}:{nodes:BottleneckOption[];onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [id,setId]=useState(nodes[0]?.id??"");const [profile,setProfile]=useState(staffingProfile(nodes[0]??{}));
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
    <DialogTitle>Staffing by time period</DialogTitle><DialogDescription>Configure each intersection and group it by area. Saving requirements updates coverage checks; run optimization again to generate a matching schedule.</DialogDescription>
    <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setError(null);try{await updateDashboardBottleneck(id,profile);await onSaved();onClose();}catch(error){setError(error instanceof Error?error.message:"Unable to save staffing.");}finally{setBusy(false);}}}>
      <label className="grid gap-1 text-sm">Intersection<select value={id} required disabled={busy} onChange={e=>{setId(e.target.value);setProfile(staffingProfile(nodes.find(n=>n.id===e.target.value)??{}));setError(null);}} className={inputClass}>{nodes.map(n=><option key={n.id} value={n.id}>{n.area_name?n.area_name+" / ":""}{n.name}</option>)}</select></label>
      <fieldset disabled={busy}><StaffingProfileFields value={profile} onChange={setProfile}/></fieldset>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><button disabled={busy||!id} className="rounded bg-yellow-400 px-4 py-2 text-sm font-medium">{busy?"Saving…":"Save staffing"}</button><button type="button" disabled={busy} onClick={onClose} className="rounded border px-4 py-2 text-sm">Cancel</button></div>
    </form>
  </DialogContent></Dialog>;
}
