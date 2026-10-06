export const OPERATIONAL_TIME_ZONE = "Asia/Manila";
export function isDeploymentActive(row: { status: string; start_time: string; end_time: string }, at = Date.now()) {
  return row.status === "assigned" && Date.parse(row.start_time) <= at && at < Date.parse(row.end_time);
}
export function operationalDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone: OPERATIONAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(value);
  const part = (key: string) => parts.find(p => p.type === key)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function operationalHour(value: string | Date) {
  return Number(new Intl.DateTimeFormat("en-US", {timeZone: OPERATIONAL_TIME_ZONE, hour: "2-digit", hourCycle: "h23"}).format(new Date(value)));
}
export function operationalShift(value = new Date()): "morning" | "afternoon" {
  return operationalHour(value) < 14 ? "morning" : "afternoon";
}
export function operationalTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-PH", {timeZone: OPERATIONAL_TIME_ZONE, hour: "numeric", minute: "2-digit"}).format(new Date(value));
}
