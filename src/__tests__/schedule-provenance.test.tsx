import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ScheduleProvenance } from "../app/components/ScheduleProvenance";
import { fetchScheduleProvenance, type ScheduleProvenanceSnapshot } from "../app/services/backend";

vi.mock("../app/services/backend", async original => ({...await original<typeof import("../app/services/backend")>(), fetchScheduleProvenance: vi.fn()}));
const day = "2026-10-21";
function snapshot(date = day): ScheduleProvenanceSnapshot {
  return {operational_date: date, checked_at: `${date}T16:00:00+08:00`, shifts: [{shift: "afternoon",
    latest_publication: {state: "modified", run_id: "saved-run", publication_count: 1, revision_id: 42, operational_date: date,
      shift: "afternoon", published_at: `${date}T14:00:00+08:00`, published_by: "Supervisor", effective_start: `${date}T14:00:00+08:00`,
      effective_end: `${date}T22:00:00+08:00`, replacing_run_ids: [], manual_changes: true, message: "Assignments were edited after publication."},
    manual_assignment_count: 1, optimized_assignment_count: 3, assignments_changed_since_publication: true,
    sources: [{revision_id: 42, run_id: "saved-run", published_at: `${date}T14:00:00+08:00`, published_by: "Supervisor", assignment_count: 3}],
  }]};
}
beforeEach(() => {vi.clearAllMocks(); vi.mocked(fetchScheduleProvenance).mockResolvedValue(snapshot());});
function panel(date = day, refreshKey = 0) {return <MemoryRouter><ScheduleProvenance day={date} shift="afternoon" refreshKey={refreshKey} /></MemoryRouter>;}

it("keeps the source summary compact and links current recorded origins to the saved recommendation", async () => {
  render(panel());
  const summary = screen.getByText(/Schedule source and edits/);
  expect(summary.closest("details")?.open).toBe(false);
  await waitFor(() => expect(summary.textContent).toContain("Changes recorded after publication"));
  fireEvent.click(summary);
  expect(screen.getByText("Published · Modified")).toBeTruthy();
  expect(screen.getByText(/Manual assignments: 1/).textContent).toContain("Optimization assignments: 3");
  expect(screen.getByText(/All areas. Counts describe recorded assignment intervals/)).toBeTruthy();
  expect(screen.getByRole("link", {name: /Review source recommendation/}).getAttribute("href")).toBe("/optimization-engine?run_id=saved-run");
  expect(screen.getByText(/The current schedule differs/)).toBeTruthy();
});

it("refreshes after a publication change and shows an unavailable state instead of a false publication status", async () => {
  render(panel());
  fireEvent.click(screen.getByText(/Schedule source and edits/));
  await screen.findByText("Published · Modified");
  vi.mocked(fetchScheduleProvenance).mockRejectedValueOnce(new Error("Source service unavailable."));
  act(() => {window.dispatchEvent(new CustomEvent("deployment-publication-changed"));});
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Source service unavailable."));
  expect(screen.queryByText("Published · Modified")).toBeNull();
  expect(screen.queryByText("No recorded optimization publication for this shift.")).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "Retry source information"}));
  expect(await screen.findByText("Published · Modified")).toBeTruthy();
  expect(fetchScheduleProvenance).toHaveBeenCalledTimes(3);
});

it("ignores a late response from another operational date", async () => {
  let finishOld!: (value: ScheduleProvenanceSnapshot) => void;
  vi.mocked(fetchScheduleProvenance).mockImplementationOnce(() => new Promise(resolve => {finishOld = resolve;}));
  const {rerender} = render(panel());
  const nextDay = "2026-10-22";
  vi.mocked(fetchScheduleProvenance).mockResolvedValueOnce({...snapshot(nextDay), shifts: []});
  rerender(panel(nextDay));
  await waitFor(() => expect(fetchScheduleProvenance).toHaveBeenLastCalledWith(nextDay, "afternoon"));
  await act(async () => {finishOld(snapshot());});
  fireEvent.click(screen.getByText(/Schedule source and edits/));
  expect(screen.queryByText("Published · Modified")).toBeNull();
  expect(screen.getByText(/2026-10-22/)).toBeTruthy();
});
