# tailtrack

Tracks aircraft flying over locations you care about. Subscribe a lat/lon/radius, and a
scheduled poller checks [airplanes.live](https://airplanes.live) every minute for aircraft
in range, logging any that weren't seen recently.

## How it works

- **`SubscriptionsTable`** (DynamoDB) — `subscriptionId` → `lat`, `lon`, `radiusNm`. No CRUD
  API yet; add subscriptions directly (console/CLI).
- **`PollSubscriptionsFunction`** (Lambda) — runs every minute via EventBridge. Scans all
  subscriptions, queries airplanes.live for each, skips aircraft still on the ground, and
  diffs against `SeenAircraftTable` to find genuinely new arrivals. Logs a `new_aircraft`
  event (JSON, to CloudWatch Logs) for each one, enriched with airline/route data looked up
  from [adsbdb.com](https://api.adsbdb.com) by callsign.
- **`SeenAircraftTable`** (DynamoDB) — `subscriptionId` + `icaoHex` → full aircraft record
  (position, altitude, speed, squawk, registration, type, route, etc). TTL-evicted 5 minutes
  after last sighting, so a plane that leaves and comes back later counts as new again.
- **`GetAircraftFunction`** (Lambda) — on-demand lookup, direct-invoke only (no HTTP
  endpoint yet). Accepts either `{ "subscriptionId": "..." }` or
  `{ "lat": ..., "lon": ..., "radiusNm": ... }` (radius defaults to 50nm) and returns the
  current aircraft in range.

Known limitation: route/airline data comes from a callsign→schedule lookup, not a live flight
plan, so it can be wrong for delayed flights or reused flight numbers.

## Prerequisites

- Node.js and npm
- AWS credentials configured (`aws sts get-caller-identity` should succeed)
- The target AWS account/region bootstrapped for CDK (`npx cdk bootstrap`, one-time)

## Useful commands

* `npm run build`     type-check the project
* `npm run watch`     watch for changes and type-check
* `npm run test`      run the jest unit tests
* `npx cdk synth`     emit the synthesized CloudFormation template
* `npx cdk diff`      compare deployed stack with current state
* `npx cdk deploy`    deploy this stack to your configured AWS account/region

## Adding a subscription

No API yet — insert directly into DynamoDB:

```bash
aws dynamodb put-item \
  --table-name <SubscriptionsTable name, from stack outputs> \
  --item '{
    "subscriptionId": {"S": "jfk-area"},
    "lat": {"N": "40.6413"},
    "lon": {"N": "-73.7781"},
    "radiusNm": {"N": "50"}
  }'
```

Stack output names (table names, function names) are printed after `cdk deploy`, or fetch them
any time with:

```bash
aws cloudformation describe-stacks --stack-name TailtrackStack --query "Stacks[0].Outputs"
```
