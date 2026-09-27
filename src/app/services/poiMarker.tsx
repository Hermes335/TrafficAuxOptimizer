const svgNamespace = "http://www.w3.org/2000/svg";

export const poiCategories = [
  {value: "hospital", label: "Hospital", color: "#b91c1c",
    shape: "M9 3H31C35 3 37 5 37 9V30C37 34 34 37 30 37H26L20 46L14 37H10C6 37 3 34 3 30V9C3 5 5 3 9 3Z",
    symbol: "M17 12H23V18H29V24H23V30H17V24H11V18H17Z", filled: true},
  {value: "fire_station", label: "Fire station", color: "#c2410c",
    shape: "M20 2L36 11V29L20 46L4 29V11Z",
    symbol: "M20 10C19 16 13 17 13 25C13 31 16 35 20 35C25 35 28 31 28 25C28 21 25 18 24 15C23 19 21 20 20 22C20 18 21 14 20 10Z", filled: true},
  {value: "police_station", label: "Police station", color: "#1d4ed8",
    shape: "M20 2L35 8V22C35 33 28 40 20 46C12 40 5 33 5 22V8Z",
    symbol: "M20 12L22.7 18.1L29.2 18.8L24.3 23.3L25.6 29.8L20 26.5L14.4 29.8L15.7 23.3L10.8 18.8L17.3 18.1Z", filled: true},
  {value: "school", label: "School", color: "#6d28d9",
    shape: "M20 3L37 16V35L20 46L3 35V16Z",
    symbol: "M10 17C14 16 17 17 20 19C23 17 26 16 30 17V31C26 30 23 31 20 33C17 31 14 30 10 31ZM20 19V33", filled: false},
  {value: "other", label: "Other place", color: "#334155",
    shape: "M20 2C29.4 2 37 9.6 37 19C37 30 29 38 20 46C11 38 3 30 3 19C3 9.6 10.6 2 20 2Z",
    symbol: "M20 12A7 7 0 1 0 20 26A7 7 0 1 0 20 12Z", filled: true},
] as const;

export type PoiCategory = (typeof poiCategories)[number]["value"];

export function poiCategoryStyle(category: string) {
  const normalized = category === "firestation" ? "fire_station" : category === "policestation" ? "police_station" : category;
  return poiCategories.find(item => item.value === normalized) ?? poiCategories[poiCategories.length - 1];
}

export function PoiSymbol({category, className = "h-5 w-5"}: {category: string; className?: string}) {
  const style = poiCategoryStyle(category);
  return <svg className={className} viewBox="0 0 40 48" aria-hidden="true" focusable="false">
    <path d={style.shape} fill={style.color} stroke="white" strokeWidth="2.5" />
    <path d={style.symbol} fill={style.filled ? "white" : "none"} stroke={style.filled ? "none" : "white"}
      strokeWidth={style.filled ? 0 : 2.5} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function updatePoiMarkerElement(button: HTMLButtonElement, category: string, name: string) {
  const style = poiCategoryStyle(category);
  if (button.dataset.poiCategory !== style.value) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 40 48");
    svg.setAttribute("width", "30");
    svg.setAttribute("height", "36");
    svg.setAttribute("aria-hidden", "true");
    const outline = document.createElementNS(svgNamespace, "path");
    outline.setAttribute("d", style.shape);
    outline.setAttribute("fill", style.color);
    outline.setAttribute("stroke", "white");
    outline.setAttribute("stroke-width", "2.5");
    const symbol = document.createElementNS(svgNamespace, "path");
    symbol.setAttribute("d", style.symbol);
    symbol.setAttribute("fill", style.filled ? "white" : "none");
    symbol.setAttribute("stroke", style.filled ? "none" : "white");
    symbol.setAttribute("stroke-width", style.filled ? "0" : "2.5");
    symbol.setAttribute("stroke-linecap", "round");
    symbol.setAttribute("stroke-linejoin", "round");
    svg.append(outline, symbol);
    button.replaceChildren(svg);
    button.dataset.poiCategory = style.value;
  }
  button.setAttribute("aria-label", `${style.label}: ${name}`);
  button.title = `${style.label}: ${name}`;
}

export function createPoiMarkerElement(category: string, name: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "poi-marker cursor-pointer border-0 bg-transparent p-0 drop-shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
  button.style.width = "30px";
  button.style.height = "36px";
  updatePoiMarkerElement(button, category, name);
  return button;
}
