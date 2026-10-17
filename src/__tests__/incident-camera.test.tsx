import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CameraPhotoPicker } from "../app/pages/IncidentReport/CameraPhotoPicker";

const getUserMedia = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, "mediaDevices", {configurable:true,value:{getUserMedia}});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Object.defineProperty(URL, "createObjectURL", {configurable:true,value:vi.fn(() => "blob:photo-preview")});
  Object.defineProperty(URL, "revokeObjectURL", {configurable:true,value:vi.fn()});
});
afterEach(() => vi.restoreAllMocks());

it("stops a stream returned after the user closes a pending camera request", async () => {
  const stop = vi.fn();
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockReturnValue(new Promise(done => {resolve = done;}));
  render(<CameraPhotoPicker photo={null} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", {name:"Open camera"}));
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({audio:false, video:expect.objectContaining({facingMode:{ideal:"environment"}})}));
  fireEvent.click(screen.getByRole("button", {name:"Close camera"}));
  await act(async () => resolve({getTracks:() => [{stop}]} as unknown as MediaStream));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Camera preview")).toBeNull();
});

it("stops a late camera stream after navigation unmounts the page", async () => {
  const stop = vi.fn();
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockReturnValue(new Promise(done => {resolve = done;}));
  const {unmount} = render(<CameraPhotoPicker photo={null} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", {name:"Open camera"})); unmount();
  await act(async () => resolve({getTracks:() => [{stop}]} as unknown as MediaStream));
  expect(stop).toHaveBeenCalledTimes(1);
});

it("stops an active camera on unmount and does not request microphone permission", async () => {
  const stop = vi.fn();
  getUserMedia.mockResolvedValue({getTracks:() => [{stop}]} as unknown as MediaStream);
  const {unmount} = render(<CameraPhotoPicker photo={null} onChange={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole("button", {name:"Open camera"})));
  expect(screen.getByRole("button", {name:"Capture photo"})).toHaveProperty("disabled",false);
  unmount(); expect(stop).toHaveBeenCalledTimes(1);
  expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
});

it("offers a photo upload after denied camera permission", async () => {
  getUserMedia.mockRejectedValue(new DOMException("Denied","NotAllowedError"));
  const onChange = vi.fn();
  render(<CameraPhotoPicker photo={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", {name:"Open camera"}));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringContaining("Camera permission was denied"));
  const file = new File(["image fixture"],"photo.jpg",{type:"image/jpeg"});
  fireEvent.change(screen.getByLabelText("Choose photo"), {target:{files:[file]}});
  expect(onChange).toHaveBeenCalledWith(file);
});

it("validates the image type and size while preserving an existing photo", () => {
  const original = new File(["existing"],"original.png",{type:"image/png"});
  const onChange = vi.fn();
  const {unmount} = render(<CameraPhotoPicker photo={original} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Choose photo"), {target:{files:[new File(["script"],"image.svg",{type:"image/svg+xml"})]}});
  expect(screen.getByRole("alert").textContent).toContain("JPEG or PNG");
  const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)],"large.jpg",{type:"image/jpeg"});
  fireEvent.change(screen.getByLabelText("Choose photo"), {target:{files:[large]}});
  expect(screen.getByRole("alert").textContent).toContain("smaller than 5 MB");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByAltText("Photo attached to your report")).toBeTruthy();
  unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:photo-preview");
});

it("captures a still, stops the camera, and lets the user confirm the photo", async () => {
  const stop = vi.fn(); const onChange = vi.fn();
  getUserMedia.mockResolvedValue({getTracks:() => [{stop}]} as unknown as MediaStream);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["jpeg"],{type:"image/jpeg"})));
  render(<CameraPhotoPicker photo={null} onChange={onChange} />);
  await act(async () => fireEvent.click(screen.getByRole("button", {name:"Open camera"})));
  const video = screen.getByLabelText("Camera preview");
  Object.defineProperty(video,"videoWidth",{value:1600}); Object.defineProperty(video,"videoHeight",{value:1200});
  fireEvent.click(screen.getByRole("button", {name:"Capture photo"}));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.getByAltText("Captured photo preview")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Use photo"}));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({name:"incident-photo.jpg",type:"image/jpeg"}));
  expect(screen.queryByLabelText("Camera preview")).toBeNull();
});
