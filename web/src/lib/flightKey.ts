import type { Flight } from "./types";

// Stable identifier for a flight within one search's results, shared between
// the list and the map so a click in one can find the matching item in the
// other. Must be computed from the same (unfiltered) index in both places.
export function flightKey(flight: Flight, index: number): string {
  return flight.aircraftRecord.callSign ?? flight.aircraftRecord.registration ?? `flight-${index}`;
}
