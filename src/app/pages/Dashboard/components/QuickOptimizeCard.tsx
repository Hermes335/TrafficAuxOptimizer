import { Target, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import type { Incident } from "../../../services/backend";
import { WeatherStatus } from "../../../components/WeatherStatus";

interface QuickOptimizeCardProps {
  selectedShift: string;
  setSelectedShift: (v: string) => void;
  selectedIncident: Incident | null;
}

export function QuickOptimizeCard({ selectedShift, setSelectedShift, selectedIncident }: QuickOptimizeCardProps) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="mb-4 flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-800"><Target className="h-4 w-4" /></span>
      <h3 className="text-base font-semibold text-slate-900">Quick Optimize</h3>
    </div>
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium text-slate-600">Plan a shift</p>
      <div className="grid grid-cols-2 gap-2">
        {([{name:"Morning",time:"6 AM – 2 PM"},{name:"Afternoon",time:"2 PM – 10 PM"}]).map(shift => <button key={shift.name} aria-pressed={selectedShift === shift.name} onClick={() => setSelectedShift(shift.name)} className={`rounded-lg border px-2 py-2 text-sm font-medium ${selectedShift === shift.name ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
          {shift.name}<span className="mt-1 block whitespace-nowrap text-xs font-normal">{shift.time}</span>
        </button>)}
      </div>
    </div>
    <div className="mb-4 rounded-lg bg-slate-50 p-3"><WeatherStatus /></div>
    <Link to={`/optimization?shift=${selectedShift.toLowerCase()}`} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300">Configure Optimization<ArrowUpRight className="h-4 w-4 shrink-0" /></Link>
    {selectedIncident && <p className="mt-3 text-xs leading-relaxed text-slate-600">Incident detected at <strong>{selectedIncident.text.split(" - ")[1] ?? selectedIncident.text}</strong>. Consider recalculating deployment.</p>}
  </section>;
}
