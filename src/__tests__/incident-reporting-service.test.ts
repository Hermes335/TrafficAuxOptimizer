import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchIncidentPhoto, submitIncidentReport } from "../app/services/incidentReporting";
import { mapRequest } from "../app/hooks/useMapIntegration";

vi.mock("maplibre-gl", () => ({ default: {} }));
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it("submits an anonymous exact pin and photo using the same retry key without a staff credential", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({id: 14, reference: "receipt", status: "pending"})));
  vi.stubGlobal("fetch", fetchMock);
  const photo = new File(["photo"], "capture.jpg", {type: "image/jpeg"});
  const payload = {latitude: 10.721234, longitude: 122.561234, incident_type: "collision", severity: "major",
    description: "Blocked lane", submission_key: "c0d7fe5f-9c08-4f41-9409-9ac472a69584", photo};
  expect(await submitIncidentReport(payload)).toMatchObject({status: "pending", reference: "receipt"});
  const options = fetchMock.mock.calls[0][1];
  expect(options.headers.Authorization).toBeUndefined();
  expect(options.headers["Content-Type"]).toBeUndefined();
  expect(options.body.get("latitude")).toBe("10.721234");
  expect(options.body.get("longitude")).toBe("122.561234");
  expect(options.body.get("submission_key")).toBe(payload.submission_key);
  expect(options.body.get("photo")).toBe(photo);
  expect(options.body.get("bottleneck")).toBeNull();
});

it("returns useful validation errors and their status to preserve safe retry behavior", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({photo: ["Choose a JPEG or PNG photo."]}), {status: 400})));
  await expect(submitIncidentReport({latitude: 10.7, longitude: 122.5, incident_type: "other", severity: "minor", description: "Test", submission_key: "key"}))
    .rejects.toMatchObject({status: 400, message: "photo: Choose a JPEG or PNG photo."});
});

it("fetches incident photos with staff authorization as blobs", async () => {
  localStorage.setItem("auth_token", "staff-token");
  const fetchMock = vi.fn().mockResolvedValue(new Response("image", {headers: {"Content-Type": "image/jpeg"}}));
  vi.stubGlobal("fetch", fetchMock);
  const photo = await fetchIncidentPhoto(14);
  expect(photo.type).toBe("image/jpeg");
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/incidents\/14\/photo\/$/);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer staff-token");
});

it("sends map credentials only to the backend tile endpoint and reads refreshed tokens", () => {
  localStorage.setItem("auth_token", "first");
  const tile = "http://127.0.0.1:8000/api/maps/tomtom-traffic/12/1/2.png";
  expect(mapRequest(tile)).toEqual({url: tile, headers: {Authorization: "Bearer first"}});
  for (const url of ["https://a.tile.openstreetmap.org/12/1/2.png", "https://other.invalid/api/maps/1.png", "http://127.0.0.1:8000/media/photo.jpg"]) {
    expect(mapRequest(url)).toEqual({url});
  }
  localStorage.setItem("auth_token", "renewed");
  expect(mapRequest(tile).headers?.Authorization).toBe("Bearer renewed");
});
