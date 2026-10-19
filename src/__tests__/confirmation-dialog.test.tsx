import {act, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {expect, it, vi} from "vitest";
import {ConfirmDialog} from "../app/components/ConfirmDialog";

it("keeps a pending action visible, blocks repeat submission and Escape, and closes after success", async () => {
  let finish!: () => void;
  const confirm = vi.fn(() => new Promise<void>(resolve => {finish = resolve;}));
  render(<ConfirmDialog title="Remove record" description="Confirm the removal." onConfirm={confirm}
    trigger={<button>Open confirmation</button>} />);
  fireEvent.click(screen.getByText("Open confirmation"));
  fireEvent.click(screen.getByRole("button", {name:"Confirm"}));
  const dialog = screen.getByRole("alertdialog");
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(within(dialog).getByRole("button", {name:"Processing..."})).toHaveProperty("disabled", true);
  expect(within(dialog).getByRole("button", {name:"Cancel"})).toHaveProperty("disabled", true);
  fireEvent.keyDown(dialog, {key:"Escape", code:"Escape"});
  fireEvent.click(within(dialog).getByRole("button", {name:"Processing..."}));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

it("shows a rejected action inside the dialog and permits a successful retry", async () => {
  const confirm = vi.fn().mockRejectedValueOnce(new Error("Connection interrupted. Retry the action."))
    .mockResolvedValueOnce(undefined);
  render(<ConfirmDialog title="Remove record" description="Confirm the removal." onConfirm={confirm}
    trigger={<button>Open confirmation</button>} />);
  fireEvent.click(screen.getByText("Open confirmation"));
  fireEvent.click(screen.getByRole("button", {name:"Confirm"}));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Connection interrupted");
  expect(screen.getByRole("alertdialog").contains(alert)).toBe(true);
  fireEvent.click(screen.getByRole("button", {name:"Confirm"}));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("preserves typed confirmation after failure and clears it on cancellation", async () => {
  const confirm = vi.fn().mockRejectedValue(new Error("Still unavailable"));
  const cancel = vi.fn();
  render(<ConfirmDialog title="Clear test schedule" description="Confirm this action." requiresTypedConfirmation="CLEAR"
    onConfirm={confirm} onCancel={cancel} trigger={<button>Open confirmation</button>} />);
  fireEvent.click(screen.getByText("Open confirmation"));
  expect(screen.getByRole("button", {name:"Confirm"})).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByPlaceholderText("Type to confirm..."), {target:{value:"CLEAR"}});
  fireEvent.click(screen.getByRole("button", {name:"Confirm"}));
  await screen.findByRole("alert");
  expect(screen.getByPlaceholderText("Type to confirm...")).toHaveProperty("value", "CLEAR");
  fireEvent.click(screen.getByRole("button", {name:"Cancel"}));
  fireEvent.click(screen.getByText("Open confirmation"));
  expect(screen.getByPlaceholderText("Type to confirm...")).toHaveProperty("value", "");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(cancel).toHaveBeenCalledTimes(1);
});
