import type { TravelTimeModel } from "./backend";

/** Explain the saved assumption; today's default cannot describe a historical run. */
export function describeTravelOrigin(model?: TravelTimeModel): string {
  const origin = model?.default_origin;
  const validOrigin = origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)
    && Math.abs(origin.latitude) <= 90 && Math.abs(origin.longitude) <= 180;
  if (validOrigin && origin.assumed === true) {
    const label = `${origin.name} (${origin.latitude.toFixed(6)}, ${origin.longitude.toFixed(6)})`;
    if (model?.initial_location_policy === "hq_for_initial_deployment") {
      if (model.origin_reset === "daily") {
        return `At the start of each operational day, this run assumes officers start at ${label}. Same-day recorded previous posts take priority for later moves. This is a planning assumption, not live GPS tracking.`;
      }
      return `For initial deployment, this run assumes officers start at ${label}. Recorded previous posts take priority. This is a planning assumption, not live GPS tracking.`;
    }
    if (model?.initial_location_policy === "known_coordinates_then_hq") {
      if (model.origin_reset === "daily") {
        return `This run uses same-day recorded posts or saved officer coordinates recorded that day, then assumes ${label} when neither is available. Coordinates from previous days are not carried forward. This is a planning assumption, not live GPS tracking.`;
      }
      return `This run uses recorded previous posts or saved officer coordinates, then assumes ${label} when neither is available. This is a planning assumption, not live GPS tracking.`;
    }
    return `This run records ${label} as an assumed starting location. The origin priority was not recorded. This is a planning assumption, not live GPS tracking.`;
  }
  const distance = model?.missing_officer_location_distance_km;
  if (typeof distance === "number" && Number.isFinite(distance) && distance >= 0) {
    if (model?.initial_location_policy === "recorded_coordinates_then_distance_estimate") {
      return `This run uses recorded previous posts or saved officer coordinates until they are updated. Missing locations use an assumed ${distance} km travel distance. These are planning estimates, not live GPS tracking.`;
    }
    return `This saved run assumed ${distance} km when officer coordinates were missing. This is a planning assumption, not live GPS tracking.`;
  }
  return "Starting-location assumptions were not recorded for this run. Travel estimates do not confirm officers' physical locations.";
}
