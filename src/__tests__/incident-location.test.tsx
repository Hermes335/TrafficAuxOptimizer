import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { IncidentLocationPicker } from "../app/pages/IncidentReport/IncidentLocationPicker";

vi.mock("maplibre-gl", () => ({ default: { Map: class { constructor() { throw new Error("WebGL unavailable"); } } } }));
const locate = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition:locate}});
});

it("does not let a delayed GPS result overwrite a deliberately chosen intersection", () => {
  const onChange = vi.fn();
  render(<IncidentLocationPicker value={null} onChange={onChange} locations={[{id:"B-1",name:"Intersection",latitude:10.72,longitude:122.56}]} />);
  fireEvent.click(screen.getByRole("button",{name:"Use my location"}));
  fireEvent.change(screen.getByLabelText("Or choose a known intersection"),{target:{value:"B-1"}});
  act(() => locate.mock.calls[0][0]({coords:{latitude:40,longitude:70}}));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({latitude:10.72,longitude:122.56,bottleneck:"B-1"});
});

it("rejects blank and out-of-range coordinates without creating a marker", () => {
  const onChange = vi.fn();
  render(<IncidentLocationPicker value={null} onChange={onChange} locations={[]} />);
  fireEvent.click(screen.getByText("Enter coordinates manually"));
  fireEvent.click(screen.getByRole("button",{name:"Use these coordinates"}));
  expect(screen.getByRole("alert").textContent).toContain("valid latitude");
  fireEvent.change(screen.getByLabelText("Latitude"),{target:{value:"91"}});
  fireEvent.change(screen.getByLabelText("Longitude"),{target:{value:"122.56"}});
  fireEvent.click(screen.getByRole("button",{name:"Use these coordinates"}));
  expect(onChange).not.toHaveBeenCalled();
});

it("preserves manual reporting when location permission is denied", () => {
  const onChange = vi.fn();
  render(<IncidentLocationPicker value={null} onChange={onChange} locations={[]} />);
  fireEvent.click(screen.getByRole("button",{name:"Use my location"}));
  act(() => locate.mock.calls[0][1]({code:1}));
  expect(screen.getByRole("alert").textContent).toContain("permission was denied");
  expect(screen.getByRole("button",{name:"Use these coordinates"})).toHaveProperty("disabled",false);
});
