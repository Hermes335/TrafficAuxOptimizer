import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { PageStateProvider, usePageState } from "../app/contexts/PageStateContext";
import { useOfficerManagement } from "../app/hooks/useOfficerManagement";
import { useBottleneckActions } from "../app/hooks/useBottleneckActions";
import { OfficerManagement } from "../app/pages/OfficerManagement";
import { EditBottleneckOverlay } from "../app/pages/Dashboard/components/EditBottleneckOverlay";
import * as backend from "../app/services/backend";

vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(),
  fetchOfficersPage: vi.fn(), createDashboardOfficer: vi.fn(), updateDashboardOfficer: vi.fn(),
  deleteDashboardOfficer: vi.fn(), updateDashboardBottleneck: vi.fn(), deleteDashboardBottleneck: vi.fn(), fetchOfficerSkillPolicy: vi.fn(),
}));
const officer: backend.DashboardOfficerRecord = {id: 1, name: "Officer Alpha", badge_number: "ALPHA", shift: "morning", status: "available", skills: []};
const snapshot: backend.DashboardSnapshot = {...backend.getFallbackDashboardSnapshot(), bottlenecks: [
  {id: "A", name: "Intersection A", status: "normal", latitude: 10.7, longitude: 122.5},
  {id: "B", name: "Intersection B", status: "normal", latitude: 10.8, longitude: 122.6},
]};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function Navigation({children}: {children: ReactNode}) {
  const [away, setAway] = useState(false);
  return <PageStateProvider><button onClick={() => setAway(value => !value)}>Navigate</button>{!away && children}</PageStateProvider>;
}
function navigate() { fireEvent.click(screen.getByText("Navigate")); }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue({results: [officer], count: 1, next: null});
  vi.mocked(backend.fetchOfficerSkillPolicy).mockResolvedValue({version: "skills-v1", skills: []});
});

it.each(["create", "update"] as const)("keeps the roster %s form locked across navigation and refreshes the returned page after success", async action => {
  const request = deferred<void>();
  const api = action === "create" ? vi.mocked(backend.createDashboardOfficer) : vi.mocked(backend.updateDashboardOfficer);
  api.mockReturnValueOnce(request.promise);
  render(<Navigation><OfficerManagement /></Navigation>);
  await screen.findByText("Officer Alpha");
  fireEvent.click(screen.getByRole("button", {name: action === "create" ? "Add Officer" : "Edit Officer Alpha"}));
  fireEvent.change(screen.getByLabelText(/^Officer name/), {target: {value: "Submitted officer"}});
  fireEvent.change(screen.getByLabelText(/^Badge number/), {target: {value: "SUBMITTED"}});
  fireEvent.click(screen.getByRole("button", {name: action === "create" ? "Create Officer" : "Save changes"}));
  navigate(); navigate();
  await screen.findByText("Officer Alpha");
  expect(screen.getByLabelText(/^Officer name/).closest("fieldset")).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Saving..."})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Edit Officer Alpha", hidden: true})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Remove Officer Alpha", hidden: true})).toHaveProperty("disabled", true);
  expect(screen.getByLabelText(/^Officer name/)).toHaveProperty("value", "Submitted officer");
  expect(api).toHaveBeenCalledTimes(1);
  const saved = {...officer, name: "Submitted officer", badge_number: "SUBMITTED"};
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue({results: [saved], count: 1, next: null});
  await act(async () => request.resolve());
  await screen.findByText("Submitted officer");
  expect(screen.queryByLabelText(/^Officer name/)).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(action === "create" ? "added successfully" : "updated successfully");
  navigate(); navigate();
  expect(screen.getByRole("status").textContent).toContain("successfully");
});

it("guards same-frame officer submissions and editor switches, retaining a failed draft and its error while away", async () => {
  const request = deferred<void>();
  vi.mocked(backend.createDashboardOfficer).mockReturnValueOnce(request.promise);
  let management!: ReturnType<typeof useOfficerManagement>;
  function Probe() {management = useOfficerManagement({reloadOfficers: vi.fn()}); return <p>{management.officerError}</p>;}
  render(<Navigation><Probe /></Navigation>);
  act(() => {management.setAddingOfficer(true); management.setOfficerName("Draft"); management.setOfficerBadge("DRAFT");});
  let pending!: Promise<void>;
  act(() => {
    pending = management.onAddOfficer(); void management.onAddOfficer();
    management.startEditingOfficer(officer); management.resetOfficerForm(); management.setAddingOfficer(false);
  });
  expect(backend.createDashboardOfficer).toHaveBeenCalledTimes(1);
  expect(management.officerName).toBe("Draft"); expect(management.addingOfficer).toBe(true);
  navigate();
  await act(async () => {request.reject(new Error("Badge already exists")); await pending;});
  navigate();
  expect(management.officerError).toBe("Badge already exists");
  expect(management.officerName).toBe("Draft"); expect(management.savingOfficer).toBe(false);
});

it("does not leave a successfully created officer ready to submit again when roster refresh fails", async () => {
  vi.mocked(backend.createDashboardOfficer).mockResolvedValue(undefined);
  render(<Navigation><OfficerManagement /></Navigation>);
  await screen.findByText("Officer Alpha");
  fireEvent.click(screen.getByRole("button", {name: "Add Officer"}));
  fireEvent.change(screen.getByLabelText(/^Officer name/), {target: {value: "New officer"}});
  fireEvent.change(screen.getByLabelText(/^Badge number/), {target: {value: "NEW"}});
  vi.mocked(backend.fetchOfficersPage).mockRejectedValueOnce(new Error("Refresh offline"));
  fireEvent.click(screen.getByRole("button", {name: "Create Officer"}));
  expect((await screen.findByRole("alert")).textContent).toContain("Officer added, but the roster could not be refreshed");
  expect(screen.queryByLabelText(/^Officer name/)).toBeNull();
  expect(screen.getByRole("button", {name: "Add Officer"})).toHaveProperty("disabled", false);
  expect(backend.createDashboardOfficer).toHaveBeenCalledTimes(1);
});

let bottlenecks!: ReturnType<typeof useBottleneckActions>;
function BottleneckProbe({reload}: {reload: () => Promise<void>}) {
  const [error, setError] = usePageState<string | null>("bottleneckForm.error", null);
  const [notice, setNotice] = usePageState<string | null>("bottleneckForm.notice", null);
  const [deleting, setDeleting] = usePageState<string | null>("bottleneckForm.deletingId", null);
  bottlenecks = useBottleneckActions({dashboardSnapshot: snapshot, reloadDashboard: reload,
    setBottleneckActionError: setError, setBottleneckActionNotice: setNotice, setDeletingBottleneckId: setDeleting});
  return <><p role="status">{notice}</p><p>{error}</p><p>Deleting {deleting}</p>
    {bottlenecks.editingBottleneckId && <EditBottleneckOverlay {...bottlenecks} error={error}
      onSave={bottlenecks.onSaveEditedBottleneck} onClose={() => bottlenecks.setEditingBottleneckId(null)} />}</>;
}
it("keeps bottleneck saves locked on return and reloads the currently mounted dashboard after completion", async () => {
  const request = deferred<backend.Bottleneck>();
  vi.mocked(backend.updateDashboardBottleneck).mockReturnValueOnce(request.promise);
  const oldReload = vi.fn().mockResolvedValue(undefined), currentReload = vi.fn().mockResolvedValue(undefined);
  const {rerender} = render(<Navigation><BottleneckProbe reload={oldReload} /></Navigation>);
  act(() => bottlenecks.startEditingBottleneck("A"));
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Submitted intersection"}});
  let pending!: Promise<void>;
  act(() => {pending = bottlenecks.onSaveEditedBottleneck(); void bottlenecks.onSaveEditedBottleneck();});
  navigate();
  rerender(<Navigation><BottleneckProbe reload={currentReload} /></Navigation>);
  navigate();
  expect(screen.getByLabelText("Name").closest("fieldset")).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Close"})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Saving..."})).toHaveProperty("disabled", true);
  act(() => {
    bottlenecks.startEditingBottleneck("B"); bottlenecks.setEditingBottleneckId(null);
    bottlenecks.setEditLatitude("11"); void bottlenecks.onDeleteBottleneck("A");
  });
  expect(bottlenecks.editingBottleneckId).toBe("A"); expect(bottlenecks.editLatitude).toBe("10.7");
  expect(backend.updateDashboardBottleneck).toHaveBeenCalledTimes(1);
  expect(backend.deleteDashboardBottleneck).not.toHaveBeenCalled();
  await act(async () => {request.resolve({...snapshot.bottlenecks[0], name: "Submitted intersection"}); await pending;});
  expect(currentReload).toHaveBeenCalledTimes(1); expect(oldReload).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", {name: "Edit bottleneck"})).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("updated successfully");
  navigate(); navigate();
  expect(screen.getByRole("status").textContent).toContain("updated successfully");
});

it("restores an unlocked bottleneck draft and failure message when a save fails while away", async () => {
  const request = deferred<backend.Bottleneck>();
  vi.mocked(backend.updateDashboardBottleneck).mockReturnValueOnce(request.promise);
  render(<Navigation><BottleneckProbe reload={vi.fn()} /></Navigation>);
  act(() => bottlenecks.startEditingBottleneck("A"));
  fireEvent.change(screen.getByLabelText("Name"), {target: {value: "Unfinished draft"}});
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  navigate(); await act(async () => request.reject(new Error("Save offline"))); navigate();
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Unfinished draft");
  expect(screen.getByLabelText("Name").closest("fieldset")).toHaveProperty("disabled", false);
  expect(screen.getByRole("alert").textContent).toBe("Save offline");
});

it("keeps officer deletion pending after navigation and prevents conflicting edits or another delete", async () => {
  const request = deferred<void>();
  vi.mocked(backend.deleteDashboardOfficer).mockReturnValueOnce(request.promise);
  render(<Navigation><OfficerManagement /></Navigation>);
  await screen.findByText("Officer Alpha"); fireEvent.click(screen.getByRole("button", {name: "Remove Officer Alpha"}));
  fireEvent.click(screen.getByRole("button", {name: "Remove officer"}));
  navigate(); navigate(); await screen.findByText("Officer Alpha");
  expect(screen.getByRole("button", {name: "Removing..."})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Edit Officer Alpha", hidden: true})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Add Officer", hidden: true})).toHaveProperty("disabled", true);
  await act(async () => request.reject(new Error("Cannot remove assigned officer")));
  expect((await screen.findByRole("alert")).textContent).toBe("Cannot remove assigned officer");
  expect(screen.getByRole("button", {name: "Edit Officer Alpha", hidden: true})).toHaveProperty("disabled", false);
  expect(backend.deleteDashboardOfficer).toHaveBeenCalledTimes(1);
});

it("prevents bottleneck editor switches during deletion and retains completion feedback after navigation", async () => {
  const request = deferred<void>();
  vi.mocked(backend.deleteDashboardBottleneck).mockReturnValueOnce(request.promise);
  render(<Navigation><BottleneckProbe reload={vi.fn().mockResolvedValue(undefined)} /></Navigation>);
  let pending!: Promise<void>;
  act(() => {pending = bottlenecks.onDeleteBottleneck("A"); void bottlenecks.onDeleteBottleneck("B");});
  navigate(); navigate();
  act(() => bottlenecks.startEditingBottleneck("B"));
  expect(screen.getByText("Deleting A")).toBeTruthy(); expect(bottlenecks.editingBottleneckId).toBeNull();
  expect(backend.deleteDashboardBottleneck).toHaveBeenCalledTimes(1);
  navigate(); await act(async () => {request.resolve(); await pending;}); navigate();
  expect(screen.getByRole("status").textContent).toContain("A removed");
  await waitFor(() => expect(bottlenecks.savingEditBottleneck).toBe(false));
});
