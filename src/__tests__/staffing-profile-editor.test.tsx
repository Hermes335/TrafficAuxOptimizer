import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StaffingProfileFields, staffingProfile, validateStaffingProfile } from "../app/components/StaffingProfileFields";
import type { StaffingProfile } from "../app/services/backend";

function Editor({ initial, showValidation = false, changed = () => {} }: {
  initial: StaffingProfile;
  showValidation?: boolean;
  changed?: (value: StaffingProfile) => void;
}) {
  const [value, setValue] = useState(initial);
  return <StaffingProfileFields value={value} showValidation={showValidation} onChange={next => { setValue(next); changed(next); }} />;
}

const quiet = { start: "22:00", end: "24:00", required: 0, label: "Quiet period", days: [0, 1, 2, 3, 4] };

it("shows the traffic-light requirement without overwriting the saved normal minimum or periods", () => {
  const changed = vi.fn();
  render(<Editor initial={staffingProfile({min_officers_required: 3, staffing_periods: [quiet]})} changed={changed} />);
  fireEvent.change(screen.getByLabelText("Traffic lights"), {target: {value: "working"}});
  expect(screen.getByText("Working traffic lights: normally 1 officer.")).toBeTruthy();
  expect(screen.getByLabelText("Normal minimum")).toHaveProperty("value", "3");
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({signal_status: "working", min_officers_required: 3, staffing_periods: [quiet]}));
  fireEvent.change(screen.getByLabelText("Traffic lights"), {target: {value: "out_of_order"}});
  expect(screen.getByText("Traffic lights out of order: normally 3 officers.")).toBeTruthy();
  expect(screen.getByLabelText("Normal minimum")).toHaveProperty("value", "3");
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({signal_status: "out_of_order", min_officers_required: 3, staffing_periods: [quiet]}));
});

it("rejects zero capacity for working lights while keeping zero-capacity unsignalled profiles valid", () => {
  const zero = staffingProfile({min_officers_required: 0, max_officers_allowed: 0});
  expect(validateStaffingProfile(zero)).toEqual({});
  expect(validateStaffingProfile({...zero, signal_status: "working"})).toHaveProperty("max_officers_allowed", "Working traffic lights require capacity for at least 1 officer.");
});

it("preserves zero demand, end-of-day times, adjacent periods and different weekdays", () => {
  const profile = staffingProfile({ min_officers_required: 0, max_officers_allowed: 0, staffing_periods: [
    { start: "21:00", end: "22:00", required: 0, days: [0, 1, 2, 3, 4] }, quiet,
    { start: "22:00", end: "24:00", required: 0, days: [5, 6] },
  ] });
  expect(validateStaffingProfile(profile)).toEqual({});
  expect(profile.staffing_periods[1]).toEqual(quiet);
});

it("reports count limits, overlap, quarter-hour, empty-day and label errors by field", () => {
  const errors = validateStaffingProfile(staffingProfile({ min_officers_required: 5, max_officers_allowed: 4, staffing_periods: [
    { start: "06:00", end: "08:00", required: 5, days: [0] },
    { start: "07:00", end: "09:00", required: 1, days: [0] },
    { start: "10:10", end: "10:00", required: 0.5, days: [], label: "x".repeat(81) },
  ] }));
  for (const field of ["max_officers_allowed", "periods.0.start", "periods.0.required", "periods.1.start", "periods.2.start", "periods.2.end", "periods.2.required", "periods.2.days", "periods.2.label"]) {
    expect(errors[field], field).toBeTruthy();
  }
  expect(validateStaffingProfile(staffingProfile({ min_officers_required: Number.NaN }))).toHaveProperty("min_officers_required");
  expect(validateStaffingProfile(staffingProfile({ staffing_periods: [{ ...quiet, days: [0, 0] }] }))).toHaveProperty("periods.0.days");
});

it("starts existing periods collapsed with readable zero-demand summaries and preserves midnight when edited", () => {
  const changed = vi.fn();
  render(<Editor initial={staffingProfile({ staffing_periods: [quiet] })} changed={changed} />);
  const card = screen.getByRole("button", { name: /Quiet period/ });
  expect(card.getAttribute("aria-expanded")).toBe("false");
  expect(card.textContent).toContain("Mon–Fri · 10:00 PM–12:00 AM (end of day)");
  expect(card.textContent).toContain("0 officers · no post required");
  expect(screen.queryByRole("textbox", { name: "Period 1 label" })).toBeNull();
  fireEvent.click(card);
  expect(screen.getByRole("combobox", { name: "Period 1 end" })).toHaveProperty("value", "24:00");
  fireEvent.change(screen.getByLabelText("Period 1 label"), { target: { value: "Evening quiet" } });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ staffing_periods: [{ ...quiet, label: "Evening quiet" }] }));
});

it("opens new periods and treats a blank officer count as missing instead of silently changing it to zero", () => {
  const changed = vi.fn();
  render(<Editor initial={staffingProfile({ min_officers_required: 0 })} changed={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Add staffing period" }));
  const officers = screen.getByRole("spinbutton", { name: "Period 1 officers" });
  expect(officers).toHaveProperty("value", "0");
  fireEvent.change(officers, { target: { value: "" } });
  expect(officers).toHaveProperty("value", "");
  expect(officers.getAttribute("aria-invalid")).toBe("true");
  expect(Number.isNaN(changed.mock.lastCall?.[0].staffing_periods[0].required)).toBe(true);
  fireEvent.change(officers, { target: { value: "0" } });
  expect(officers.getAttribute("aria-invalid")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove period 1" }));
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ staffing_periods: [] }));
});

it("reveals invalid periods on save and leaves the card open after the error is corrected", async () => {
  const initial = staffingProfile({ staffing_periods: [{ ...quiet, required: 6 }] });
  const { rerender } = render(<Editor initial={initial} />);
  expect(screen.getByRole("button", { name: /Quiet period/ }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("Check this period’s settings")).toBeTruthy();
  rerender(<Editor initial={initial} showValidation />);
  await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Period 1 officers" })).toBeTruthy());
  const officers = screen.getByLabelText("Period 1 officers");
  expect(document.getElementById(officers.getAttribute("aria-describedby")!)?.textContent).toBe("Cannot exceed the maximum officers.");
  fireEvent.change(officers, { target: { value: "0" } });
  expect(screen.getByRole("button", { name: /Quiet period/ }).getAttribute("aria-expanded")).toBe("true");
});

it("expands and focuses a collapsed invalid period when a shared native form is submitted", async () => {
  render(<form><Editor initial={staffingProfile({ staffing_periods: [{ ...quiet, required: 6 }] })} /><button>Save</button></form>);
  const card = screen.getByRole("button", { name: /Quiet period/ });
  expect(card.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("spinbutton", { name: "Period 1 officers" })));
  expect(card.getAttribute("aria-expanded")).toBe("true");
});
