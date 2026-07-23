export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

// Free, keyless geocoding via OpenStreetMap Nominatim — fine for a personal,
// low-volume tool (their usage policy caps at ~1 request/sec).
export async function geocodeLocation(query: string): Promise<GeocodeResult> {
  const params = new URLSearchParams({ q: query, format: "json", limit: "1" });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Location lookup failed");
  }

  const results = (await response.json()) as NominatimResult[];
  const first = results[0];
  if (!first) {
    throw new Error(`No location found for "${query}"`);
  }

  return { lat: Number(first.lat), lon: Number(first.lon), displayName: first.display_name };
}
