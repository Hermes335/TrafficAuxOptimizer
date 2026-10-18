import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PageStateProvider } from "../app/contexts/PageStateContext";
import { OfficerManagement } from "../app/pages/OfficerManagement";
import * as backend from "../app/services/backend";

vi.mock("../app/services/backend", async original => ({
  ...await original<typeof import("../app/services/backend")>(),
  fetchOfficersPage: vi.fn(), createDashboardOfficer: vi.fn(),
  updateDashboardOfficer: vi.fn(), deleteDashboardOfficer: vi.fn(),
}));

const alpha: backend.DashboardOfficerRecord = {
  id: 1, name: "Officer Alpha", badge_number: "ALPHA", shift: "morning", status: "available", skills: ["First aid"],
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
});

it("keeps search and filters together, resets pagination, and clears all filters", async () => {
  vi.mocked(backend.fetchOfficersPage).mockResolvedValue(page([alpha, beta], 26));
  await roster();
  expect(screen.getByRole("heading", {name: "Officer Management", level: 1})).toBeTruthy();
  expect(screen.getByLabelText("Search officers")).toHaveProperty("placeholder", "Search name or badge");
  expect(screen.getByText("First aid")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Next page"}));
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
  expect(screen.getByRole("button", {name: "Previous page"})).toHaveProperty("disabled", true);
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
  fireEvent.change(screen.getByLabelText(/^Skills/), {target: {value: " First aid, , Driving "}});
  vi.mocked(backend.createDashboardOfficer).mockRejectedValueOnce(new Error("Badge already exists"));
  fireEvent.click(screen.getByRole("button", {name: "Create Officer"}));
  expect((await screen.findByRole("alert")).textContent).toContain("Badge already exists");
  expect(backend.createDashboardOfficer).toHaveBeenCalledWith({
    name: "Officer Gamma", badge_number: "GAMMA", shift: "morning", status: "unavailable", skills: ["First aid", "Driving"],
  });
  expect(screen.getByLabelText(/^Officer name/)).toHaveProperty("value", "  Officer Gamma  ");
  expect(screen.getByRole("button", {name: "Create Officer"})).toHaveProperty("disabled", false);
  vi.mocked(backend.createDashboardOfficer).mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", {name: "Create Officer"}));
  await waitFor(() => expect(screen.queryByLabelText(/^Officer name/)).toBeNull());
  expect(backend.createDashboardOfficer).toHaveBeenCalledTimes(2);
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
  fireEvent.click(screen.getByRole("button", {name: "Next page"}));
  await screen.findByRole("button", {name: "Remove Officer Beta"});
  fireEvent.click(screen.getByRole("button", {name: "Remove Officer Beta"}));
  fireEvent.click(screen.getByRole("button", {name: "Remove officer"}));
  await screen.findByRole("button", {name: "Edit Officer Alpha"});
  expect(backend.deleteDashboardOfficer).toHaveBeenCalledExactlyOnceWith(beta.id);
  expect(backend.fetchOfficersPage).toHaveBeenLastCalledWith(1, "", "all", "all");
  expect(screen.getByRole("button", {name: "Previous page"})).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", {name: "Next page"})).toHaveProperty("disabled", true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("button", {name: "Edit Officer Beta"})).toBeNull();
});
