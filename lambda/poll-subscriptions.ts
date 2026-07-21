import { DynamoDBClient, ScanCommand, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

interface Subscription {
  subscriptionId: string;
  lat: number;
  lon: number;
  radiusNm: number;
}

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

const ROUTE_INFO_FIELDS: (keyof RouteInfo)[] = [
  'airlineName',
  'airlineIcao',
  'airlineIata',
  'originAirportIcao',
  'originAirportIata',
  'originAirportName',
  'originAirportMunicipality',
  'destinationAirportIcao',
  'destinationAirportIata',
  'destinationAirportName',
  'destinationAirportMunicipality',
];

const ddb = new DynamoDBClient({});
const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE!;
const SEEN_AIRCRAFT_TABLE = process.env.SEEN_AIRCRAFT_TABLE!;
const SEEN_TTL_SECONDS = 5 * 60;

export const handler = async () => {
  const subscriptions = await getAllSubscriptions();
  await Promise.all(subscriptions.map(pollSubscription));
};

async function getAllSubscriptions(): Promise<Subscription[]> {
  const subscriptions: Subscription[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: SUBSCRIPTIONS_TABLE,
        ExclusiveStartKey: lastEvaluatedKey as never,
      }),
    );
    for (const item of result.Items ?? []) {
      subscriptions.push(unmarshall(item) as Subscription);
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return subscriptions;
}

async function pollSubscription(subscription: Subscription): Promise<void> {
  const { subscriptionId, lat, lon, radiusNm } = subscription;

  const url = `https://api.airplanes.live/v2/point/${lat}/${lon}/${radiusNm}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`airplanes.live request failed for ${subscriptionId}: ${response.status} ${response.statusText}`);
    return;
  }

  const data = (await response.json()) as { ac?: RawAircraft[] };
  const aircraft = data.ac ?? [];
  const expiresAt = Math.floor(Date.now() / 1000) + SEEN_TTL_SECONDS;

  for (const ac of aircraft) {
    if (!ac.hex) continue;
    if (ac.alt_baro === 'ground') continue; // parked/taxiing, not flying overhead

    const seen = await ddb.send(
      new GetItemCommand({
        TableName: SEEN_AIRCRAFT_TABLE,
        Key: {
          subscriptionId: { S: subscriptionId },
          icaoHex: { S: ac.hex },
        },
      }),
    );

    const record = toAircraftRecord(ac);

    // Route/airline data doesn't change mid-flight, so only look it up on
    // first sighting and carry it forward on subsequent polls.
    const route = seen.Item ? extractRouteInfo(unmarshall(seen.Item)) : await lookupRoute(ac.flight);

    if (!seen.Item) {
      console.log(
        JSON.stringify({
          event: 'new_aircraft',
          subscriptionId,
          icaoHex: ac.hex,
          ...record,
          ...route,
        }),
      );
    }

    await ddb.send(
      new PutItemCommand({
        TableName: SEEN_AIRCRAFT_TABLE,
        Item: marshall(
          {
            subscriptionId,
            icaoHex: ac.hex,
            expiresAt,
            ...record,
            ...route,
          },
          { removeUndefinedValues: true },
        ),
      }),
    );
  }
}

async function lookupRoute(flight: string | undefined): Promise<RouteInfo | undefined> {
  const callsign = flight?.trim();
  if (!callsign) return undefined;

  try {
    const response = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`);
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      response?: {
        flightroute?: {
          airline?: { name?: string; icao?: string; iata?: string };
          origin?: { icao_code?: string; iata_code?: string; name?: string; municipality?: string };
          destination?: { icao_code?: string; iata_code?: string; name?: string; municipality?: string };
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
    console.error(`Route lookup failed for ${callsign}: ${(err as Error).message}`);
    return undefined;
  }
}

function extractRouteInfo(item: Record<string, unknown>): RouteInfo | undefined {
  const route: RouteInfo = {};
  let hasAny = false;

  for (const field of ROUTE_INFO_FIELDS) {
    const value = item[field];
    if (typeof value === 'string') {
      route[field] = value;
      hasAny = true;
    }
  }

  return hasAny ? route : undefined;
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
