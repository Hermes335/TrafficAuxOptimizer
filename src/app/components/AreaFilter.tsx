export function AreaFilter({nodes,value,onChange}:{nodes:{area_name?:string}[];value:string;onChange:(value:string)=>void}) {
  const areas=[...new Set(nodes.map(n=>n.area_name?.trim()).filter((n):n is string=>!!n))].sort();
  return <label className="flex items-center gap-2 text-sm">Area<select aria-label="Area filter" className="rounded border bg-white px-2 py-2" value={value} onChange={e=>onChange(e.target.value)}><option value="">All areas</option><option value="__ungrouped">Ungrouped</option>{areas.map(a=><option key={a} value={a}>{a}</option>)}</select></label>;
}
export function inArea(node:{area_name?:string},area:string){return !area||(area==="__ungrouped"?!node.area_name?.trim():node.area_name?.trim()===area);}
