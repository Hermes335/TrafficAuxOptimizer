import type { POI } from "./backend";
import { poiCategories } from "./poiMarker";

export function popupCard(title: string, lines: string[] = []) {
  const container = document.createElement("div");
  container.className = "space-y-2 p-2 text-sm text-gray-900";
  const heading = document.createElement("strong");
  heading.textContent = title;
  container.append(heading);
  for (const line of lines) {
    const row = document.createElement("p");
    row.textContent = line;
    container.append(row);
  }
  return container;
}

export function poiPopup(poi: POI, save: (data: {name: string; category: string; priority_boost: number}) => Promise<void>, remove: () => Promise<void>) {
  const form = document.createElement("form");
  form.className = "space-y-2 p-2 text-sm";
  const label = (text: string, input: HTMLElement) => {
    const wrapper = document.createElement("label");
    wrapper.className = "block";
    wrapper.textContent = text;
    input.className = "block w-full rounded border p-1";
    wrapper.append(input); form.append(wrapper);
  };
  const name = document.createElement("input");
  name.value = poi.name; name.required = true;
  label("Name", name);
  const category = document.createElement("select");
  for (const {value, label: categoryLabel} of poiCategories) {
    const option = document.createElement("option");
    option.value = value; option.textContent = categoryLabel;
    category.append(option);
  }
  category.value = poi.category;
  label("Category", category);
  const boost = document.createElement("input");
  boost.type = "number"; boost.min = "1"; boost.max = "5"; boost.step = "0.5"; boost.value = String(poi.priority_boost);
  label("Priority boost", boost);
  const error = document.createElement("p");
  error.setAttribute("role", "alert"); error.className = "text-red-700";
  const submit = document.createElement("button");
  submit.type = "submit"; submit.textContent = "Save"; submit.className = "rounded bg-blue-700 p-2 text-white";
  const del = document.createElement("button");
  del.type = "button"; del.textContent = "Delete"; del.className = "ml-2 rounded border p-2 text-red-700";
  const run = async (action: () => Promise<void>) => {
    submit.disabled = del.disabled = true; error.textContent = "";
    try { await action(); } catch (err) { error.textContent = err instanceof Error ? err.message : "Unable to save. Retry."; }
    finally { submit.disabled = del.disabled = false; }
  };
  form.addEventListener("submit", event => { event.preventDefault(); void run(() => save({name: name.value, category: category.value, priority_boost: Number(boost.value)})); });
  del.addEventListener("click", () => { void run(remove); });
  form.append(error, submit, del);
  return form;
}
