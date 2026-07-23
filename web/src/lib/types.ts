// Mirrors the response shape from lambda/get-flights-for-location.ts.
// Trimmed to the fields the UI actually displays.
export interface AircraftRecord {
  callSign?: string;
  registration?: string;
  aircraftTypeCode?: string;
  aircraftDescription?: string;
  ownerOperator?: string;
  baroAltitudeFt?: number | string;
  groundSpeedKt?: number;
  headingDegrees?: number;
  verticalRateFpm?: number;
  squawkCode?: string;
  latitude?: number;
  longitude?: number;
  distanceNm?: number;
  bearingDegrees?: number;
}

export interface RouteInfo {
  airlineName?: string;
  airlineIcao?: string;
  airlineIata?: string;
  originAirportIcao?: string;
  originAirportIata?: string;
  originAirportName?: string;
  originAirportMunicipality?: string;
  destinationAirportIcao?: string;
  destinationAirportIata?: string;
  destinationAirportName?: string;
  destinationAirportMunicipality?: string;
}

export interface Flight {
  aircraftRecord: AircraftRecord;
  routeInfo?: RouteInfo;
  flightRadarUrl?: string;
}
