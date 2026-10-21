import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePageState } from "../contexts/PageStateContext";

// Closed details do not mount Recharts. The preference is scoped to this saved
// run and app session, so opening one run does not expand every other result.
export function OptimizationDetailsSection({runId, children}: {runId: string; children: ReactNode}) {
  const [open, setOpen] = usePageState(`results.advanced.${runId}`, false);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="mb-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    <summary className="cursor-pointer py-1 font-semibold text-slate-800">Advanced charts and scoring</summary>
    <p className="mt-2 text-sm text-slate-600">Search history, saved score arithmetic and solution trade-offs support a closer review.</p>
    {open && <div className="mt-5 min-w-0 space-y-6">{children}</div>}
  </details>;
}

// A newly opened native details panel can briefly report zero width. Observe
// its actual size before mounting a responsive chart, and recheck on reopen.
export function MeasuredResultChart({children, className = ""}: {children: ReactNode; className?: string}) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setReady(rect.width > 0 && rect.height > 0);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return <div ref={container} className={className}>{ready ? children : <p className="text-sm text-slate-500">Preparing chart…</p>}</div>;
}
