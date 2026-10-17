export function AreaFilter({nodes,value,onChange}:{nodes:{area_name?:string}[];value:string;onChange:(value:string)=>void}) {
  const areas=[...new Set(nodes.map(n=>n.area_name?.trim()).filter((n):n is string=>!!n))].sort();
  return <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-600">Area<select aria-label="Area filter" className="h-9 min-w-0 max-w-48 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900" value={value} onChange={e=>onChange(e.target.value)}><option value="">All areas</option><option value="__ungrouped">Ungrouped</option>{areas.map(a=><option key={a} value={a}>{a}</option>)}</select></label>;
}
export function inArea(node:{area_name?:string},area:string){return !area||(area==="__ungrouped"?!node.area_name?.trim():node.area_name?.trim()===area);}
