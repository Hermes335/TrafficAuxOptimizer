import { usePageState, useResetPageState } from "../../contexts/PageStateContext";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { StaffingProfileFields, staffingProfile } from "../../components/StaffingProfileFields";
import { matchingOfficerSkills, officerSkillLabel } from "../../services/officerSkills";
import { saveDeploymentAssignment, updateDashboardBottleneck, type BottleneckOption, type DashboardOfficerRecord,
  type DeploymentAssignmentPayload, type DeploymentScheduleItem } from "../../services/backend";

const inputClass="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";
function localTime(value:string) {
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Manila",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
}

export function AssignmentEditor({assignment, day, initialShift, officers, nodes, onClose, onSaved}:{
  assignment:DeploymentScheduleItem|null;day:string;initialShift:string;officers:DashboardOfficerRecord[];nodes:BottleneckOption[];onClose:()=>void;onSaved:()=>Promise<void>;
}) {
  const prefix = `assignment.${day}.${assignment?.id ?? "new"}.`;
  const resetDraft = useResetPageState(prefix);
  const close = () => { resetDraft(); onClose(); };
  const [shift,setShift]=usePageState<"morning"|"afternoon">(prefix + "shift", (assignment?.shift ?? (initialShift === "morning" ? "morning":"afternoon")) as "morning"|"afternoon");
  const [officer,setOfficer]=usePageState(prefix + "officer", String(assignment?.officer_id ?? officers.find(o=>o.badge_number===assignment?.officer)?.id ?? ""));
  const [node,setNode]=usePageState(prefix + "node", assignment?.bottleneck ?? "");
  const [start,setStart]=usePageState(prefix + "start", assignment ? localTime(new Date(Math.max(Date.parse(assignment.start_time),Math.ceil(Date.now()/60000)*60000)).toISOString()) : shift === "morning"?"06:00":"14:00");
  const [end,setEnd]=usePageState(prefix + "end", assignment ? localTime(assignment.end_time) : shift === "morning"?"14:00":"22:00");
  const [kind,setKind]=usePageState<DeploymentAssignmentPayload["assignment_type"]>(prefix + "kind", (assignment?.assignment_type ?? "static") as DeploymentAssignmentPayload["assignment_type"]);
  const [busy,setBusy]=usePageState(prefix + "busy", false);const [error,setError]=useState<string|null>(null);
  const [reason,setReason]=usePageState(prefix + "reason", "");
  const selectedNode = nodes.find(current => current.id === node);
  const preferredSkills = selectedNode?.preferred_skills;
  const selectedOfficer = officers.find(current => String(current.id) === officer);
  const matchedSkills = matchingOfficerSkills(selectedOfficer?.skills ?? [], preferredSkills ?? []);
  const eligibleOfficers = officers.filter(current => current.shift === shift && ["available", "deployed"].includes(current.status))
    .sort((left, right) => Number(matchingOfficerSkills(right.skills, preferredSkills ?? []).length > 0)
      - Number(matchingOfficerSkills(left.skills, preferredSkills ?? []).length > 0));
  const submit=async(cancel=false)=>{
    setBusy(true);setError(null);
    try {
      await saveDeploymentAssignment({officer:Number(officer),bottleneck:node,shift,
        start_time:`${day}T${start}:00+08:00`,end_time:`${day}T${end}:00+08:00`,assignment_type:kind,
        status:cancel?"cancelled":"assigned",expected_updated_at:assignment?.updated_at,override_reason:reason},assignment?.id);
      await onSaved();close();
    } catch(e) {setError(e instanceof Error?e.message:"Unable to save assignment.");} finally {setBusy(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)close();}}><DialogContent className="max-h-[90vh] overflow-y-auto">
    <DialogTitle>{assignment?"Edit assignment":"Add timed assignment"}</DialogTitle><DialogDescription>Set the officer, intersection and time window for {day} in Asia/Manila. Overlaps, shift limits and location capacity are checked before saving.</DialogDescription>
    <form onSubmit={e=>{e.preventDefault();void submit();}} className="space-y-3">
      <label className="grid gap-1 text-sm">Shift<select disabled={!!assignment||busy} value={shift} onChange={e=>{const value=e.target.value as typeof shift;setShift(value);setOfficer("");setStart(value==="morning"?"06:00":"14:00");setEnd(value==="morning"?"14:00":"22:00");}} className={inputClass}><option value="morning">Morning · 06:00–14:00</option><option value="afternoon">Afternoon · 14:00–22:00</option></select></label>
      <label className="grid gap-1 text-sm">Intersection<select required disabled={busy} value={node} onChange={e=>setNode(e.target.value)} className={inputClass}><option value="">Select intersection</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.area_name ? n.area_name+" / ":""}{n.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Officer<select required disabled={busy} value={officer} onChange={e=>setOfficer(e.target.value)} className={inputClass}><option value="">Select officer</option>{eligibleOfficers.map(current=><option key={current.id} value={current.id}>{current.badge_number} · {current.name}{matchingOfficerSkills(current.skills, preferredSkills ?? []).length ? " · Skill match" : ""}</option>)}</select></label>
      {selectedNode && <section aria-label="Assignment skill preferences" className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <p className="font-medium text-slate-800">{preferredSkills === undefined ? "Skill preferences unavailable" : preferredSkills.length ? `Preferred skills: ${preferredSkills.map(officerSkillLabel).join(", ")}` : "No specific skill preference for this location."}</p>
        {selectedOfficer && !!preferredSkills?.length && <p>{matchedSkills.length ? `Recorded match: ${matchedSkills.map(officerSkillLabel).join(", ")}.` : "No recorded skill match. This officer can still be assigned."}</p>}
        <p>Matching officers appear first. Skills are a preference; availability, time conflicts and staffing limits are checked when saving.</p>
      </section>}
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm">Start time<input type="time" required disabled={busy} value={start} onChange={e=>setStart(e.target.value)} className={inputClass}/></label><label className="grid gap-1 text-sm">End time<input type="time" required disabled={busy} value={end} onChange={e=>setEnd(e.target.value)} className={inputClass}/></label></div>
      <label className="grid gap-1 text-sm">Assignment type<select disabled={busy} value={kind} onChange={e=>setKind(e.target.value as typeof kind)} className={inputClass}><option value="static">Static post</option><option value="mobile">Mobile patrol</option><option value="response">Rapid response</option></select></label>
      <label className="grid gap-1 text-sm">Override reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} disabled={busy} className={inputClass} placeholder="Required when adding excess staffing or reducing staffing below the requirement."/></label>
      {assignment?.override_reason&&<p className="text-xs text-slate-500">Previous reason: {assignment.override_reason}</p>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-500">{busy?"Saving…":"Save assignment"}</button><button type="button" disabled={busy} onClick={close} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Close</button>{assignment&&<button type="button" disabled={busy} onClick={()=>void submit(true)} className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-700">End / cancel assignment</button>}</div>
    </form>
  </DialogContent></Dialog>;
}

export function StaffingEditor({nodes,onClose,onSaved}:{nodes:BottleneckOption[];onClose:()=>void;onSaved:()=>Promise<void>}) {
  const resetDraft = useResetPageState("staffingEditor.");
  const close = () => { resetDraft(); onClose(); };
  const [id,setId]=usePageState("staffingEditor.id",nodes[0]?.id??"");const [profile,setProfile]=usePageState("staffingEditor.profile",staffingProfile(nodes[0]??{}));
  const [busy,setBusy]=usePageState("staffingEditor.busy",false);const [error,setError]=useState<string|null>(null);
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)close();}}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
    <DialogTitle>Staffing by time period</DialogTitle><DialogDescription>Configure each intersection and group it by area. Saving requirements updates coverage checks; run optimization again to generate a matching schedule.</DialogDescription>
    <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setError(null);try{await updateDashboardBottleneck(id,profile);await onSaved();close();}catch(error){setError(error instanceof Error?error.message:"Unable to save staffing.");}finally{setBusy(false);}}}>
      <label className="grid gap-1 text-sm">Intersection<select value={id} required disabled={busy} onChange={e=>{setId(e.target.value);setProfile(staffingProfile(nodes.find(n=>n.id===e.target.value)??{}));setError(null);}} className={inputClass}>{nodes.map(n=><option key={n.id} value={n.id}>{n.area_name?n.area_name+" / ":""}{n.name}</option>)}</select></label>
      <fieldset disabled={busy}><StaffingProfileFields value={profile} onChange={setProfile}/></fieldset>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><button disabled={busy||!id} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-500">{busy?"Saving…":"Save staffing"}</button><button type="button" disabled={busy} onClick={close} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancel</button></div>
    </form>
  </DialogContent></Dialog>;
}
