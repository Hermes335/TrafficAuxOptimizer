import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IncidentReview } from "../app/pages/IncidentReview";
import * as reporting from "../app/services/incidentReporting";

vi.mock("../app/services/incidentReporting", () => ({
  fetchPendingReports: vi.fn(),
  reviewIncidentReport: vi.fn(),
  fetchIncidentPhoto: vi.fn(),
}));

const report: reporting.ReportIncident = {
  id: 51,
  incident_type: "road_closure",
  severity: "major",
  description: "A fallen tree is blocking the eastern lane.",
  latitude: 10.315699,
  longitude: 123.885437,
  bottleneck: null,
  status: "pending",
  timestamp: "2026-10-17T02:00:00Z",
};

const createObjectURL = vi.fn(() => "blob:private-incident-photo");
const revokeObjectURL = vi.fn();
const NativeURL = globalThis.URL;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reporting.fetchPendingReports).mockResolvedValue([{ ...report }]);
  vi.mocked(reporting.reviewIncidentReport).mockResolvedValue(undefined);
  vi.mocked(reporting.fetchIncidentPhoto).mockResolvedValue(new Blob(["test photo"], { type: "image/jpeg" }));
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps a report after a failed approval and removes it only after a successful retry", async () => {
  vi.mocked(reporting.reviewIncidentReport).mockRejectedValueOnce(new Error("Review service unavailable"));
  render(<IncidentReview />);
  const approve = await screen.findByRole("button", { name: "Approve report #51" });
  const map = screen.getByRole("link", { name: /View pin on map/ });
  expect(map.getAttribute("href")).toContain("mlat=10.315699&mlon=123.885437");
  fireEvent.click(approve);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Review service unavailable");
  expect(screen.getByText(report.description)).toBeTruthy();
  fireEvent.click(approve);
  await screen.findByText("No reports waiting for review");
  expect(screen.queryByText(report.description)).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("now active on the dashboard");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Review incident reports" }));
  expect(reporting.reviewIncidentReport).toHaveBeenNthCalledWith(1, 51, "approve");
  expect(reporting.reviewIncidentReport).toHaveBeenNthCalledWith(2, 51, "approve");
});

it("confirms rejection, preserves reports after errors, and lets staff retry", async () => {
  vi.mocked(reporting.reviewIncidentReport).mockRejectedValueOnce(new Error("Could not reject report"));
  render(<IncidentReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Reject report #51" }));
  expect(reporting.reviewIncidentReport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep report" }));
  expect(reporting.reviewIncidentReport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reject report #51" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not reject report");
  expect(screen.getByText(report.description)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
  await screen.findByText("Report #51 rejected.");
  expect(screen.queryByRole("article")).toBeNull();
  expect(reporting.reviewIncidentReport).toHaveBeenLastCalledWith(51, "reject");
});

it("prevents duplicate reviews and refreshes while a decision is saving", async () => {
  let finishReview!: () => void;
  vi.mocked(reporting.reviewIncidentReport).mockImplementationOnce(() => new Promise(resolve => { finishReview = resolve; }));
  render(<IncidentReview />);
  const approve = await screen.findByRole("button", { name: "Approve report #51" });
  fireEvent.click(approve);
  fireEvent.click(approve);
  expect(reporting.reviewIncidentReport).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Refresh reports" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Reject report #51" })).toHaveProperty("disabled", true);
  finishReview();
  await screen.findByText("No reports waiting for review");
});

it("retries initial loading and keeps existing reports if a refresh fails", async () => {
  vi.mocked(reporting.fetchPendingReports).mockRejectedValueOnce(new Error("Cannot load reports"));
  render(<IncidentReview />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Cannot load reports"));
  expect(screen.queryByText("No reports waiting for review")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading reports" }));
  await screen.findByText(report.description);
  vi.mocked(reporting.fetchPendingReports).mockRejectedValueOnce(new Error("Refresh failed"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh reports" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText(/Refresh failed.*Previously loaded/)).toBeTruthy();
  expect(screen.getByText(report.description)).toBeTruthy();
});

it("loads protected photos by report ID and releases the private blob after review", async () => {
  vi.mocked(reporting.fetchPendingReports).mockResolvedValue([{ ...report, photo_url: "/api/private-photo/51/" }]);
  render(<IncidentReview />);
  const photo = await screen.findByRole("img", { name: "Photo submitted with this incident report" });
  expect(reporting.fetchIncidentPhoto).toHaveBeenCalledWith(51);
  expect(photo.getAttribute("src")).toBe("blob:private-incident-photo");
  expect(photo.getAttribute("src")).not.toContain("/api/");
  fireEvent.click(screen.getByRole("button", { name: "Approve report #51" }));
  await screen.findByText("No reports waiting for review");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-incident-photo");
});

it("retries a failed photo request without blocking the review controls", async () => {
  vi.mocked(reporting.fetchPendingReports).mockResolvedValue([{ ...report, photo_url: "/api/private-photo/51/" }]);
  vi.mocked(reporting.fetchIncidentPhoto).mockRejectedValueOnce(new Error("Photo request failed"));
  const { unmount } = render(<IncidentReview />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry photo" }));
  await screen.findByRole("img");
  expect(reporting.fetchIncidentPhoto).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Approve report #51" })).toHaveProperty("disabled", false);
  unmount();
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-incident-photo"));
});
