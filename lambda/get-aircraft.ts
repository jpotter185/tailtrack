import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

interface GetAircraftEvent {
  subscriptionId?: string;
  lat?: number;
  lon?: number;
  radiusNm?: number;
}

interface Subscription {
  subscriptionId: string;
  lat: number;
  lon: number;
  radiusNm: number;
}

const ddb = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const DEFAULT_RADIUS_NM = 50;

export const handler = async (event: GetAircraftEvent) => {
  const { subscriptionId, lat, lon, radiusNm } = event;

  let queryLat: number;
  let queryLon: number;
  let queryRadiusNm: number;

  if (subscriptionId) {
    const result = await ddb.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { subscriptionId: { S: subscriptionId } },
      }),
    );

    if (!result.Item) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const subscription = unmarshall(result.Item) as Subscription;
    queryLat = subscription.lat;
    queryLon = subscription.lon;
    queryRadiusNm = subscription.radiusNm;
  } else if (lat !== undefined && lon !== undefined) {
    queryLat = lat;
    queryLon = lon;
    queryRadiusNm = radiusNm ?? DEFAULT_RADIUS_NM;
  } else {
    throw new Error('Provide either subscriptionId or lat and lon');
  }

  const url = `https://api.airplanes.live/v2/point/${queryLat}/${queryLon}/${queryRadiusNm}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`airplanes.live request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { ac?: unknown[]; total?: number };

  return {
    subscriptionId,
    lat: queryLat,
    lon: queryLon,
    radiusNm: queryRadiusNm,
    aircraftCount: data.total ?? data.ac?.length ?? 0,
    aircraft: data.ac ?? [],
  };
};
