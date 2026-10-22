import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { PageStateProvider } from "../app/contexts/PageStateContext";
import { OfficerManagement } from "../app/pages/OfficerManagement";
import * as backend from "../app/services/backend";

vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(),
  fetchOfficersPage: vi.fn(), createDashboardOfficer: vi.fn(),
  updateDashboardOfficer: vi.fn(), deleteDashboardOfficer: vi.fn(), fetchOfficerSkillPolicy: vi.fn(),
}));

const alpha: backend.DashboardOfficerRecord = {
  id: 1, name: "Officer Alpha", badge_number: "ALPHA", shift: "morning", status: "available", skills: ["first_aid"],
};
const beta: backend.DashboardOfficerRecord = {
  id: 2, name: "Officer Beta", badge_number: "BETA", shift: "afternoon", status: "deployed", skills: [],
};
type OfficerPage = Awaited<ReturnType<typeof backend.fetchOfficersPage>>;
function page(results: backend.DashboardOfficerRecord[] = [alpha, beta], count = results.length): OfficerPage {
  return {results, count, next: null};
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function roster() {
  render(<PageStateProvider><OfficerManagement /></PageStateProvider>);
  await screen.findByRole("button", {name: "Edit Officer Alpha"});
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue(page());
  vi.mocked(backend.fetchOfficerSkillPolicy).mockResolvedValue({version: "skills-v1", skills: [
    {value: "first_aid", label: "First aid"},
    {value: "traffic_control", label: "Traffic control"},
    {value: "intersection_management", label: "Intersection management"},
    {value: "school_crossing", label: "School crossing"},
    {value: "incident_response", label: "Incident response"},
  ]});
});

it("leaves saved coordinates and their confirmation time out of ordinary roster edits", async () => {
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue(page([{...alpha, current_latitude: 10.72, current_longitude: 122.56, current_location_recorded_at: "2026-10-20T23:00:00Z"}]));
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  expect(screen.getByLabelText("Location update")).toHaveProperty("value", "unchanged");
  fireEvent.change(screen.getByLabelText(/^Officer name/), {target: {value: "Updated name"}});
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  await waitFor(() => expect(backend.updateDashboardOfficer).toHaveBeenCalledWith(1, {
    name: "Updated name", badge_number: "ALPHA", shift: "morning", status: "available", skills: ["first_aid"],
  }));
});

it("explicitly reconfirms existing coordinates without sending a client timestamp", async () => {
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue(page([{...alpha, current_latitude: 10.72, current_longitude: 122.56}]));
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  fireEvent.change(screen.getByLabelText("Location update"), {target: {value: "confirm"}});
  expect(screen.getByLabelText("Starting latitude")).toHaveProperty("value", "10.72");
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  await waitFor(() => expect(backend.updateDashboardOfficer).toHaveBeenCalledWith(1, {
    name: "Officer Alpha", badge_number: "ALPHA", shift: "morning", status: "available", skills: ["first_aid"],
    current_latitude: 10.72, current_longitude: 122.56,
  }));
});

it("requires both valid coordinates before confirming a location", async () => {
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  fireEvent.change(screen.getByLabelText("Location update"), {target: {value: "confirm"}});
  fireEvent.change(screen.getByLabelText("Starting latitude"), {target: {value: "91"}});
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  expect(screen.getByLabelText("Starting latitude").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText("Starting longitude").getAttribute("aria-invalid")).toBe("true");
  expect(backend.updateDashboardOfficer).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Starting latitude")));
});

it("clears both coordinates only after an explicit location action", async () => {
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  fireEvent.change(screen.getByLabelText("Location update"), {target: {value: "clear"}});
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  await waitFor(() => expect(backend.updateDashboardOfficer).toHaveBeenCalledWith(1, expect.objectContaining({
    current_latitude: null, current_longitude: null,
  })));
});

it("keeps search and filters together, resets pagination, and clears all filters", async () => {
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue(page([alpha, beta], 26));
  await roster();
  expect(screen.getByRole("heading", {name: "Officer Management", level: 1})).toBeTruthy();
  expect(screen.getByLabelText("Search officers")).toHaveProperty("placeholder", "Search name or badge");
  expect(screen.getByText("First aid")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("navigation", {name: "Officer pagination above roster"})).getByRole("button", {name: "Next page"}));
  await waitFor(() => expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(2, "", "all", "all"));
  fireEvent.change(screen.getByLabelText("Status filter"), {target: {value: "available"}});
  await waitFor(() => expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "", "available", "all"));
  fireEvent.change(screen.getByLabelText("Shift filter"), {target: {value: "morning"}});
  fireEvent.change(screen.getByLabelText("Search officers"), {target: {value: "ALPHA"}});
  await waitFor(() => expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "ALPHA", "available", "morning"));
  fireEvent.click(screen.getByRole("button", {name: "Clear filters"}));
  await waitFor(() => expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "", "all", "all"));
  expect(screen.getByLabelText("Search officers")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Status filter")).toHaveProperty("value", "all");
  expect(screen.getByLabelText("Shift filter")).toHaveProperty("value", "all");
  expect(within(screen.getByRole("navigation", {name: "Officer pagination above roster"})).getByRole("button", {name: "Previous page"})).toHaveProperty("disabled", true);
});

it("keeps the top and bottom page controls synchronized while preserving roster filters", async () => {
  vi.mocked(backend.fetchOfficersPage).mockImplementation(async currentPage => page(currentPage === 1 ? [alpha] : [beta], 26));
  await roster();
  const above = within(screen.getByRole("navigation", {name: "Officer pagination above roster"}));
  const below = within(screen.getByRole("navigation", {name: "Officer pagination below roster"}));
  fireEvent.change(screen.getByLabelText("Shift filter"), {target: {value: "morning"}});
  await waitFor(() => expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "", "all", "morning"));
  fireEvent.click(above.getByRole("button", {name: "Next page"}));
  await screen.findByRole("button", {name: "Edit Officer Beta"});
  expect(above.getByRole("button", {name: "Go to page 2"}).getAttribute("aria-current")).toBe("page");
  expect(below.getByRole("button", {name: "Go to page 2"}).getAttribute("aria-current")).toBe("page");
  expect(below.getByRole("button", {name: "Next page"})).toHaveProperty("disabled", true);
  fireEvent.click(below.getByRole("button", {name: "Previous page"}));
  await screen.findByRole("button", {name: "Edit Officer Alpha"});
  expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "", "all", "morning");
  expect(above.getByRole("button", {name: "Go to page 1"}).getAttribute("aria-current")).toBe("page");
  expect(below.getByRole("button", {name: "Go to page 1"}).getAttribute("aria-current")).toBe("page");
});

it("does not replace a newer search result when an older request finishes late", async () => {
  await roster();
  const oldSearch = deferred<OfficerPage>(), latestSearch = deferred<OfficerPage>();
  vi.mocked(backend.fetchOfficersPage).mockReturnValueOnce(oldSearch.promise).mockReturnValueOnce(latestSearch.promise);
  fireEvent.change(screen.getByLabelText("Search officers"), {target: {value: "ALPHA"}});
  await waitFor(() => expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "ALPHA", "all", "all"));
  fireEvent.change(screen.getByLabelText("Search officers"), {target: {value: "BETA"}});
  await waitFor(() => expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "BETA", "all", "all"));
  await act(async () => latestSearch.resolve(page([beta])));
  await screen.findByRole("button", {name: "Edit Officer Beta"});
  await act(async () => oldSearch.resolve(page([alpha])));
  expect(screen.queryByRole("button", {name: "Edit Officer Alpha"})).toBeNull();
  expect(screen.getByRole("button", {name: "Edit Officer Beta"})).toBeTruthy();
});

it("creates an officer from the labelled editor and preserves a failed draft for retry", async () => {
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Add Officer"}));
  expect(screen.getByRole("button", {name: "Create Officer"})).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText(/^Officer name/), {target: {value: "  Officer Gamma  "}});
  fireEvent.change(screen.getByLabelText(/^Badge number/), {target: {value: " GAMMA "}});
  fireEvent.change(screen.getByLabelText("Shift"), {target: {value: "morning"}});
  fireEvent.change(screen.getByLabelText("Status"), {target: {value: "unavailable"}});
  fireEvent.click(await screen.findByRole("checkbox", {name: "First aid"}));
  fireEvent.click(screen.getByRole("checkbox", {name: "Traffic control"}));
  vi.mocked(backend.createDashboardOfficer).mockRejectedValueOnce(new Error("Badge already exists"));
  fireEvent.click(screen.getByRole("button", {name: "Create Officer"}));
  expect((await screen.findByRole("alert")).textContent).toContain("Badge already exists");
  expect(backend.createDashboardOfficer).toHaveBeenCalledWith({
    name: "Officer Gamma", badge_number: "GAMMA", shift: "morning", status: "unavailable", skills: ["first_aid", "traffic_control"],
  });
  expect(screen.getByLabelText(/^Officer name/)).toHaveProperty("value", "  Officer Gamma  ");
  expect(screen.getByRole("button", {name: "Create Officer"})).toHaveProperty("disabled", false);
  vi.mocked(backend.createDashboardOfficer).mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", {name: "Create Officer"}));
  await waitFor(() => expect(screen.queryByLabelText(/^Officer name/)).toBeNull());
  expect(backend.createDashboardOfficer).toHaveBeenCalledTimes(2);
});

it("retains a created-officer shortcut across navigation and only changes filters when View officer is chosen", async () => {
  const gamma: backend.DashboardOfficerRecord = {...beta, id: 3, name: "Officer Gamma", badge_number: "GAMMA"};
  vi.mocked(backend.fetchOfficersPage).mockImplementation(async (_page, search) => page(search === "GAMMA" ? [gamma] : [alpha]));
  const pending = deferred<void>();
  vi.mocked(backend.createDashboardOfficer).mockReturnValueOnce(pending.promise);
  function NavigableRoster() {
    const [away, setAway] = useState(false);
    return <PageStateProvider><button onClick={() => setAway(value => !value)}>Navigate</button>{!away && <OfficerManagement />}</PageStateProvider>;
  }
  render(<NavigableRoster />);
  await screen.findByRole("button", {name: "Edit Officer Alpha"});
  fireEvent.change(screen.getByLabelText("Status filter"), {target: {value: "available"}});
  fireEvent.change(screen.getByLabelText("Shift filter"), {target: {value: "morning"}});
  fireEvent.change(screen.getByLabelText("Search officers"), {target: {value: "ALPHA"}});
  await waitFor(() => expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "ALPHA", "available", "morning"));
  fireEvent.click(screen.getByRole("button", {name: "Add Officer"}));
  fireEvent.change(screen.getByLabelText(/^Officer name/), {target: {value: "Officer Gamma"}});
  fireEvent.change(screen.getByLabelText(/^Badge number/), {target: {value: " GAMMA "}});
  fireEvent.click(screen.getByRole("button", {name: "Create Officer"}));
  fireEvent.click(screen.getByText("Navigate"));
  await act(async () => pending.resolve());
  fireEvent.click(screen.getByText("Navigate"));
  const recent = within(await screen.findByRole("region", {name: "Recently added officer"}));
  await waitFor(() => expect(recent.getByRole("button", {name: "View officer"})).toHaveProperty("disabled", false));
  expect(screen.getByLabelText("Search officers")).toHaveProperty("value", "ALPHA");
  expect(screen.getByLabelText("Status filter")).toHaveProperty("value", "available");
  expect(screen.getByLabelText("Shift filter")).toHaveProperty("value", "morning");
  expect(screen.queryByRole("button", {name: "Edit Officer Gamma"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "Dismiss success notification"}));
  expect(recent.getByRole("button", {name: "View officer"})).toBeTruthy();
  fireEvent.click(recent.getByRole("button", {name: "View officer"}));
  await screen.findByRole("button", {name: "Edit Officer Gamma"});
  expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "GAMMA", "all", "all");
  expect(screen.getByLabelText("Status filter")).toHaveProperty("value", "all");
  expect(screen.getByLabelText("Shift filter")).toHaveProperty("value", "all");
  expect(document.activeElement).toBe(screen.getByLabelText("Search officers"));
  expect(backend.createDashboardOfficer).toHaveBeenCalledTimes(1);
});

it("can find a saved officer after the post-create refresh failed without creating the officer again", async () => {
  const gamma: backend.DashboardOfficerRecord = {...alpha, id: 3, name: "Officer Gamma", badge_number: "GAMMA"};
  await roster();
  vi.mocked(backend.createDashboardOfficer).mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", {name: "Add Officer"}));
  fireEvent.change(screen.getByLabelText(/^Officer name/), {target: {value: "Officer Gamma"}});
  fireEvent.change(screen.getByLabelText(/^Badge number/), {target: {value: "GAMMA"}});
  vi.mocked(backend.fetchOfficersPage).mockRejectedValueOnce(new Error("Refresh offline"));
  fireEvent.click(screen.getByRole("button", {name: "Create Officer"}));
  expect((await screen.findByRole("alert")).textContent).toContain("Officer added, but the roster could not be refreshed");
  const recent = within(screen.getByRole("region", {name: "Recently added officer"}));
  vi.mocked(backend.fetchOfficersPage).mockResolvedValueOnce(page([gamma]));
  fireEvent.click(recent.getByRole("button", {name: "View officer"}));
  await screen.findByRole("button", {name: "Edit Officer Gamma"});
  expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "GAMMA", "all", "all");
  expect(backend.createDashboardOfficer).toHaveBeenCalledTimes(1);
});

it("preserves unknown skill labels and punctuation while allowing individual removal", async () => {
  const legacyOfficer = {...alpha, skills: ["first_aid", "Driving, heavy vehicles", "Radio"]};
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue(page([legacyOfficer]));
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  expect(await screen.findByRole("checkbox", {name: "First aid"})).toHaveProperty("checked", true);
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", {name: "Remove skill Radio"}));
  fireEvent.click(screen.getByRole("checkbox", {name: "School crossing"}));
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  await waitFor(() => expect(backend.updateDashboardOfficer).toHaveBeenCalledWith(1, expect.objectContaining({
    skills: ["first_aid", "Driving, heavy vehicles", "school_crossing"],
  })));
});

it("keeps an unchanged skill selection clean when it is toggled off and back on", async () => {
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue(page([{...alpha, skills: ["first_aid", "traffic_control"]}]));
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  const firstAid = await screen.findByRole("checkbox", {name: "First aid"});
  fireEvent.click(firstAid);
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", false);
  fireEvent.click(firstAid);
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", true);
});

it("retains saved skills when catalog loading fails and can retry without discarding edits", async () => {
  vi.mocked(backend.fetchOfficerSkillPolicy).mockRejectedValueOnce(new Error("Offline"));
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue(page([{...alpha, skills: ["first_aid", "Driving"]}]));
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  await screen.findByRole("button", {name: "Retry skill choices"});
  fireEvent.change(screen.getByLabelText(/^Officer name/), {target: {value: "Updated name"}});
  fireEvent.click(screen.getByRole("button", {name: "Retry skill choices"}));
  expect(await screen.findByRole("checkbox", {name: "First aid"})).toHaveProperty("checked", true);
  fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
  await waitFor(() => expect(backend.updateDashboardOfficer).toHaveBeenCalledWith(1, expect.objectContaining({
    name: "Updated name", skills: ["first_aid", "Driving"],
  })));
});

it("asks before discarding changes and keeps the draft when editing continues", async () => {
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  expect(screen.getByLabelText(/^Officer name/)).toHaveProperty("value", alpha.name);
  expect(screen.getByRole("button", {name: "Save changes"})).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText(/^Officer name/), {target: {value: "Unsaved officer"}});
  fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
  expect(screen.getByRole("alertdialog", {name: "Discard unsaved changes?"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Keep editing"}));
  expect(screen.getByLabelText(/^Officer name/)).toHaveProperty("value", "Unsaved officer");
  fireEvent.click(screen.getByRole("button", {name: "Close officer editor"}));
  fireEvent.click(screen.getByRole("button", {name: "Discard changes"}));
  await waitFor(() => expect(screen.queryByLabelText(/^Officer name/)).toBeNull());
  expect(backend.updateDashboardOfficer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "Edit Officer Alpha"}));
  expect(screen.getByLabelText(/^Officer name/)).toHaveProperty("value", alpha.name);
});

it("points to an incomplete required field without sending a create request", async () => {
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Add Officer"}));
  fireEvent.change(screen.getByLabelText(/^Badge number/), {target: {value: "NEW"}});
  fireEvent.click(screen.getByRole("button", {name: "Create Officer"}));
  const name = screen.getByLabelText(/^Officer name/);
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("Enter the officer's name.")).toBeTruthy();
  expect(backend.createDashboardOfficer).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(name));
});

it("requires removal confirmation, prevents duplicate requests, and keeps server failures in the dialog", async () => {
  await roster();
  fireEvent.click(screen.getByRole("button", {name: "Remove Officer Alpha"}));
  let confirmation = within(screen.getByRole("alertdialog", {name: "Remove officer?"}));
  expect(confirmation.getByText(/Officer Alpha/)).toBeTruthy();
  expect(backend.deleteDashboardOfficer).not.toHaveBeenCalled();
  fireEvent.click(confirmation.getByRole("button", {name: "Cancel"}));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(backend.deleteDashboardOfficer).not.toHaveBeenCalled();

  const pending = deferred<void>();
  vi.mocked(backend.deleteDashboardOfficer).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", {name: "Remove Officer Alpha"}));
  confirmation = within(screen.getByRole("alertdialog", {name: "Remove officer?"}));
  const remove = confirmation.getByRole("button", {name: "Remove officer"});
  fireEvent.click(remove); fireEvent.click(remove);
  expect(backend.deleteDashboardOfficer).toHaveBeenCalledExactlyOnceWith(alpha.id);
  expect(confirmation.getByRole("button", {name: "Removing..."})).toHaveProperty("disabled", true);
  expect(confirmation.getByRole("button", {name: "Cancel"})).toHaveProperty("disabled", true);
  fireEvent.keyDown(screen.getByRole("alertdialog"), {key: "Escape"});
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  await act(async () => pending.reject(new Error("Cannot remove assigned officer")));
  expect(confirmation.getByRole("alert").textContent).toBe("Cannot remove assigned officer");
  expect(confirmation.getByRole("button", {name: "Remove officer"})).toHaveProperty("disabled", false);
  fireEvent.click(confirmation.getByRole("button", {name: "Cancel"}));
  expect(screen.getByRole("button", {name: "Edit Officer Alpha"})).toHaveProperty("disabled", false);
});

it("returns to the previous page when deleting the last officer on the last page", async () => {
  let removed = false;
  vi.mocked(backend.fetchOfficersPage).mockImplementation(async currentPage => {
    if (currentPage === 2) return page(removed ? [] : [beta], removed ? 25 : 26);
    return page([alpha], removed ? 25 : 26);
  });
  vi.mocked(backend.deleteDashboardOfficer).mockImplementation(async () => {removed = true;});
  await roster();
  fireEvent.click(within(screen.getByRole("navigation", {name: "Officer pagination above roster"})).getByRole("button", {name: "Next page"}));
  await screen.findByRole("button", {name: "Remove Officer Beta"});
  fireEvent.click(screen.getByRole("button", {name: "Remove Officer Beta"}));
  fireEvent.click(screen.getByRole("button", {name: "Remove officer"}));
  await screen.findByRole("button", {name: "Edit Officer Alpha"});
  expect(backend.deleteDashboardOfficer).toHaveBeenCalledExactlyOnceWith(beta.id);
  expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "", "all", "all");
  expect(within(screen.getByRole("navigation", {name: "Officer pagination above roster"})).getByRole("button", {name: "Previous page"})).toHaveProperty("disabled", true);
  expect(within(screen.getByRole("navigation", {name: "Officer pagination above roster"})).getByRole("button", {name: "Next page"})).toHaveProperty("disabled", true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("button", {name: "Edit Officer Beta"})).toBeNull();
});
