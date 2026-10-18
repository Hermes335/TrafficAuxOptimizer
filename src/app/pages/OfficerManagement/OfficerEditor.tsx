import * as Dialog from "@radix-ui/react-dialog";
import { UserRound, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { useOfficerManagement } from "../../hooks/useOfficerManagement";

interface OfficerEditorProps {
  management: ReturnType<typeof useOfficerManagement>;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function OfficerEditor({ management, onClose, returnFocusRef }: OfficerEditorProps) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [touched, setTouched] = useState<{ name?: boolean; badge?: boolean }>({});
  const editing = management.editingOfficerId !== null;
  const busy = management.savingOfficer || management.deletingOfficerId !== null;
  const hasErrors = Object.keys(management.officerFieldErrors).length > 0;
  const visibleError = (field: "name" | "badge") => validationAttempt || touched[field]
    ? management.officerFieldErrors[field] : undefined;
  const inputClass = "mt-1.5 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 aria-invalid:border-rose-500 disabled:bg-slate-50 disabled:text-slate-500";
  const labelClass = "text-sm font-medium text-slate-700";
  const fieldProps = (field: "name" | "badge") => ({
    "aria-invalid": !!visibleError(field),
    "aria-describedby": visibleError(field) ? `${id}-${field}-error` : undefined,
    onBlur: () => setTouched(current => ({ ...current, [field]: true })),
  });

  useEffect(() => {
    if (!validationAttempt) return;
    const frame = window.requestAnimationFrame(() => {
      const firstError = bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstError?.focus();
      firstError?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [validationAttempt]);

  const submit = () => {
    if (busy || !management.officerFormDirty) return;
    setValidationAttempt(attempt => attempt + 1);
    if (hasErrors) return;
    void (editing ? management.onUpdateOfficer() : management.onAddOfficer());
  };

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30" />
        <Dialog.Content
          ref={contentRef}
          className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl outline-none sm:max-w-md"
          onOpenAutoFocus={event => {
            event.preventDefault();
            if (busy) contentRef.current?.focus();
            else nameRef.current?.focus();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            returnFocusRef?.current?.focus();
          }}
          onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
          onInteractOutside={event => { if (busy) event.preventDefault(); }}
        >
          <header data-officer-editor-header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <UserRound className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                <Dialog.Title className="text-lg font-semibold text-slate-950">{editing ? "Edit officer" : "Add officer"}</Dialog.Title>
              </div>
              <Dialog.Description className="mt-1 text-sm text-slate-500">
                {editing ? "Update roster details and availability." : "Add an officer to the deployment roster."}
              </Dialog.Description>
            </div>
            <button type="button" aria-label="Close officer editor" disabled={busy} onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          <form aria-label={editing ? "Edit officer details" : "New officer details"} noValidate onSubmit={event => { event.preventDefault(); submit(); }} className="flex min-h-0 flex-1 flex-col">
            <fieldset disabled={busy} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div ref={bodyRef} data-officer-editor-body className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
                <section aria-labelledby={`${id}-identity-heading`} className="space-y-4">
                  <h3 id={`${id}-identity-heading`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">Officer details</h3>
                  <div>
                    <label htmlFor={`${id}-name`} className={labelClass}>Officer name <span aria-hidden="true" className="text-rose-600">*</span></label>
                    <input ref={nameRef} id={`${id}-name`} required maxLength={255} autoComplete="off" placeholder="Officer name" value={management.officerName} onChange={event => management.setOfficerName(event.target.value)} className={inputClass} {...fieldProps("name")} />
                    {visibleError("name") && <p id={`${id}-name-error`} className="mt-1 text-xs text-rose-700">{visibleError("name")}</p>}
                  </div>
                  <div>
                    <label htmlFor={`${id}-badge`} className={labelClass}>Badge number <span aria-hidden="true" className="text-rose-600">*</span></label>
                    <input id={`${id}-badge`} required maxLength={40} autoComplete="off" placeholder="Badge number" value={management.officerBadge} onChange={event => management.setOfficerBadge(event.target.value)} className={inputClass} {...fieldProps("badge")} />
                    {visibleError("badge") && <p id={`${id}-badge-error`} className="mt-1 text-xs text-rose-700">{visibleError("badge")}</p>}
                    <p className="mt-1.5 text-xs text-slate-500">Use the officer's unique badge number.</p>
                  </div>
                </section>

                <section aria-labelledby={`${id}-availability-heading`} className="space-y-4 border-t border-slate-100 pt-5">
                  <h3 id={`${id}-availability-heading`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shift and availability</h3>
                  <div>
                    <label htmlFor={`${id}-shift`} className={labelClass}>Shift</label>
                    <select id={`${id}-shift`} value={management.officerShift} onChange={event => management.setOfficerShift(event.target.value as "morning" | "afternoon")} className={inputClass} aria-describedby={`${id}-eligibility-help`}>
                      <option value="morning">Morning · 6 AM–2 PM</option>
                      <option value="afternoon">Afternoon · 2 PM–10 PM</option>
                    </select>
                    <p className="mt-1.5 text-xs text-slate-500">Shift times use Asia/Manila.</p>
                  </div>
                  <div>
                    <label htmlFor={`${id}-status`} className={labelClass}>Status</label>
                    <select id={`${id}-status`} value={management.officerStatus} onChange={event => management.setOfficerStatus(event.target.value as "available" | "deployed" | "off_duty" | "unavailable")} className={inputClass} aria-describedby={`${id}-status-help ${id}-eligibility-help`}>
                      <option value="available">Available</option>
                      <option value="deployed" disabled>Deployed (managed by schedule)</option>
                      <option value="off_duty">Off Duty</option>
                      <option value="unavailable">Unavailable</option>
                    </select>
                    <p id={`${id}-status-help`} className="mt-1.5 text-xs text-slate-500">The schedule manages Deployed status.</p>
                  </div>
                  <p id={`${id}-eligibility-help`} className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">Cancel outstanding assignments before changing shift or marking an officer off duty or unavailable.</p>
                </section>

                <section aria-labelledby={`${id}-skills-heading`} className="border-t border-slate-100 pt-5">
                  <h3 id={`${id}-skills-heading`} className="sr-only">Officer skills</h3>
                  <label htmlFor={`${id}-skills`} className={labelClass}>Skills <span aria-hidden="true" className="font-normal text-slate-400">(optional)</span></label>
                  <input id={`${id}-skills`} placeholder="Skills (comma-separated)" value={management.officerSkillsInput} onChange={event => management.setOfficerSkillsInput(event.target.value)} className={inputClass} aria-describedby={`${id}-skills-help`} />
                  <p id={`${id}-skills-help`} className="mt-1.5 text-xs text-slate-500">Separate skills with commas, for example: first aid, traffic control.</p>
                </section>
              </div>

              <footer data-officer-editor-footer className="shrink-0 space-y-3 border-t border-slate-200 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {management.officerError && <p role="alert" className="max-h-24 overflow-y-auto rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{management.officerError}</p>}
                {validationAttempt > 0 && hasErrors
                  ? <p role="alert" className="text-xs text-rose-700">Check the highlighted fields before saving.</p>
                  : <p className="text-xs text-slate-500">{management.savingOfficer ? "Saving officer details…" : management.officerFormDirty ? "Unsaved changes" : editing ? "No changes yet" : "Fields marked * are required."}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={busy || !management.officerFormDirty} className="flex-1 rounded-lg bg-amber-400 px-3 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50">{management.savingOfficer ? "Saving..." : editing ? "Save changes" : "Create Officer"}</button>
                </div>
              </footer>
            </fieldset>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
