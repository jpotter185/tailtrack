// Raw shape returned by the airplanes.live API, field names as-is.
interface RawAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  year?: string;
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  nav_qnh?: number;
  nav_altitude_mcp?: number;
  nav_heading?: number;
  lat?: number;
  lon?: number;
  nic?: number;
  rc?: number;
  seen_pos?: number;
  version?: number;
  nic_baro?: number;
  nac_p?: number;
  nac_v?: number;
  sil?: number;
  sil_type?: string;
  gva?: number;
  sda?: number;
  alert?: number;
  spi?: number;
  mlat?: string[];
  tisb?: string[];
  messages?: number;
  seen?: number;
  rssi?: number;
  dst?: number;
  dir?: number;
}

// Aircraft fields with human-readable names, as stored in the seen-aircraft table.
interface AircraftRecord {
  positionSource?: string;
  callSign?: string;
  registration?: string;
  aircraftTypeCode?: string;
  aircraftDescription?: string;
  ownerOperator?: string;
  manufactureYear?: string;
  baroAltitudeFt?: number | string;
  geometricAltitudeFt?: number;
  groundSpeedKt?: number;
  headingDegrees?: number;
  verticalRateFpm?: number;
  squawkCode?: string;
  emergencyStatus?: string;
  wakeCategory?: string;
  navQnh?: number;
  navTargetAltitudeFt?: number;
  navTargetHeadingDegrees?: number;
  latitude?: number;
  longitude?: number;
  navigationIntegrityCategory?: number;
  radiusOfContainmentM?: number;
  positionAgeSeconds?: number;
  adsbVersion?: number;
  baroIntegrityCode?: number;
  positionAccuracyCategory?: number;
  velocityAccuracyCategory?: number;
  sourceIntegrityLevel?: number;
  sourceIntegrityLevelType?: string;
  geometricVerticalAccuracy?: number;
  systemDesignAssurance?: number;
  alertFlag?: number;
  specialPositionIndicator?: number;
  mlatFields?: string[];
  tisbFields?: string[];
  messageCount?: number;
  lastMessageAgeSeconds?: number;
  signalStrengthDbm?: number;
  distanceNm?: number;
  bearingDegrees?: number;
}

// Route/airline info looked up from adsbdb.com by callsign. ADS-B itself
// carries no flight-plan data, so this comes from a separate schedule DB.
interface RouteInfo {
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

interface Flight {
  routeInfo?: RouteInfo;
  aircraftRecord: AircraftRecord;
  flightRadarUrl?: string;
}

const ROUTE_INFO_FIELDS: (keyof RouteInfo)[] = [
  "airlineName",
  "airlineIcao",
  "airlineIata",
  "originAirportIcao",
  "originAirportIata",
  "originAirportName",
  "originAirportMunicipality",
  "destinationAirportIcao",
  "destinationAirportIata",
  "destinationAirportName",
  "destinationAirportMunicipality",
];

const MILES_PER_NM = 1.150779448;

interface HttpRequest {
  queryStringParameters?: Record<string, string | undefined>;
}

interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

function jsonResponse(statusCode: number, body: unknown): HttpResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function handler(event: HttpRequest): Promise<HttpResponse> {
  const params = event.queryStringParameters ?? {};

  const lat = Number(params.lat);
  const lon = Number(params.lon);
  if (params.lat === undefined || params.lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) {
    return jsonResponse(400, { error: "lat and lon query parameters are required and must be numbers" });
  }

  let radiusNm: number;
  if (params.radiusNm !== undefined) {
    radiusNm = Number(params.radiusNm);
  } else if (params.radiusMiles !== undefined) {
    radiusNm = Number(params.radiusMiles) / MILES_PER_NM;
  } else {
    return jsonResponse(400, { error: "radiusNm or radiusMiles query parameter is required" });
  }
  if (Number.isNaN(radiusNm)) {
    return jsonResponse(400, { error: "radius must be a number" });
  }

  try {
    const flights = await getFlights(lat, lon, radiusNm);
    return jsonResponse(200, flights);
  } catch (err) {
    console.error(`getFlights failed for ${lat},${lon}: ${(err as Error).message}`);
    return jsonResponse(500, { error: "Internal error" });
  }
}

async function getFlights(
  lat: number,
  lon: number,
  radiusNm: number,
): Promise<Flight[]> {
  console.log(`Getting aircraft within ${radiusNm}nm of ${lat},${lon}`);
  const url = `https://api.airplanes.live/v2/point/${lat}/${lon}/${radiusNm}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(
      `airplanes.live request failed for ${lat},${lon}: ${response.status} ${response.statusText}`,
    );
    return [];
  }

  const data = (await response.json()) as { ac?: RawAircraft[] };
  const aircraft = data.ac ?? [];

  let flights: Flight[] = [];
  for (const ac of aircraft) {
    if (!ac.hex) continue;
    if (ac.alt_baro === "ground") continue; // parked/taxiing, not flying overhead

    const record = toAircraftRecord(ac);

    // Route/airline data doesn't change mid-flight, so only look it up on
    // first sighting and carry it forward on subsequent polls.
    const route = await lookupRoute(ac.flight);

    console.log(
      JSON.stringify({
        event: "new_aircraft",
        icaoHex: ac.hex,
        ...record,
        ...route,
      }),
    );
    flights.push({
      aircraftRecord: record,
      routeInfo: route ? route : undefined,
      flightRadarUrl: record.callSign
        ? `https://www.flightradar24.com/${encodeURIComponent(record.callSign)}`
        : undefined,
    });
  }
  console.log(`Got ${flights.length} flights`);
  return flights;
}

async function lookupRoute(
  flight: string | undefined,
): Promise<RouteInfo | undefined> {
  const callsign = flight?.trim();
  if (!callsign) return undefined;

  try {
    const response = await fetch(
      `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`,
    );
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      response?: {
        flightroute?: {
          airline?: { name?: string; icao?: string; iata?: string };
          origin?: {
            icao_code?: string;
            iata_code?: string;
            name?: string;
            municipality?: string;
          };
          destination?: {
            icao_code?: string;
            iata_code?: string;
            name?: string;
            municipality?: string;
          };
        };
      };
    };

    const route = data.response?.flightroute;
    if (!route) return undefined;

    return {
      airlineName: route.airline?.name,
      airlineIcao: route.airline?.icao,
      airlineIata: route.airline?.iata,
      originAirportIcao: route.origin?.icao_code,
      originAirportIata: route.origin?.iata_code,
      originAirportName: route.origin?.name,
      originAirportMunicipality: route.origin?.municipality,
      destinationAirportIcao: route.destination?.icao_code,
      destinationAirportIata: route.destination?.iata_code,
      destinationAirportName: route.destination?.name,
      destinationAirportMunicipality: route.destination?.municipality,
    };
  } catch (err) {
    console.error(
      `Route lookup failed for ${callsign}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

function toAircraftRecord(ac: RawAircraft): AircraftRecord {
  return {
    positionSource: ac.type,
    callSign: ac.flight?.trim(),
    registration: ac.r,
    aircraftTypeCode: ac.t,
    aircraftDescription: ac.desc,
    ownerOperator: ac.ownOp,
    manufactureYear: ac.year,
    baroAltitudeFt: ac.alt_baro,
    geometricAltitudeFt: ac.alt_geom,
    groundSpeedKt: ac.gs,
    headingDegrees: ac.track,
    verticalRateFpm: ac.baro_rate,
    squawkCode: ac.squawk,
    emergencyStatus: ac.emergency,
    wakeCategory: ac.category,
    navQnh: ac.nav_qnh,
    navTargetAltitudeFt: ac.nav_altitude_mcp,
    navTargetHeadingDegrees: ac.nav_heading,
    latitude: ac.lat,
    longitude: ac.lon,
    navigationIntegrityCategory: ac.nic,
    radiusOfContainmentM: ac.rc,
    positionAgeSeconds: ac.seen_pos,
    adsbVersion: ac.version,
    baroIntegrityCode: ac.nic_baro,
    positionAccuracyCategory: ac.nac_p,
    velocityAccuracyCategory: ac.nac_v,
    sourceIntegrityLevel: ac.sil,
    sourceIntegrityLevelType: ac.sil_type,
    geometricVerticalAccuracy: ac.gva,
    systemDesignAssurance: ac.sda,
    alertFlag: ac.alert,
    specialPositionIndicator: ac.spi,
    mlatFields: ac.mlat,
    tisbFields: ac.tisb,
    messageCount: ac.messages,
    lastMessageAgeSeconds: ac.seen,
    signalStrengthDbm: ac.rssi,
    distanceNm: ac.dst,
    bearingDegrees: ac.dir,
  };
}
