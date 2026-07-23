import type { Flight } from "./types";

export type RadiusUnit = "nm" | "mi";

export interface FetchFlightsParams {
  lat: number;
  lon: number;
  radius: number;
  unit: RadiusUnit;
}

// Relative path — same-origin via the CloudFront distribution that fronts
// both this app and the /api/* Lambda behavior, so no CORS setup is needed.
export async function fetchFlights({ lat, lon, radius, unit }: FetchFlightsParams): Promise<Flight[]> {
  const radiusParam = unit === "nm" ? "radiusNm" : "radiusMiles";
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    [radiusParam]: String(radius),
  });

  const response = await fetch(`/api/flights?${params.toString()}`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return body as Flight[];
}
