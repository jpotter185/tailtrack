# tailtrack

CDK (TypeScript) app that tracks aircraft flying over subscribed locations, using the free
[airplanes.live](https://api.airplanes.live) ADS-B API. See README.md for the user-facing
overview; this file is oriented at working on the code.

## Structure

- `bin/tailtrack.ts` — CDK app entry point. Stack is pinned to the current CLI's
  account/region via `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION`.
- `lib/tailtrack-stack.ts` — the only stack. Defines both DynamoDB tables, both Lambdas, and
  the EventBridge schedule.
- `lambda/poll-subscriptions.ts` — scheduled poller (runs every 1 min). Entry point for most
  future feature work (notification delivery, new filtering rules, etc).
- `lambda/get-aircraft.ts` — on-demand lookup, direct-invoke only.

## Conventions

- Lambdas are bundled with `NodejsFunction` (esbuild); `@aws-sdk/*` is marked
  `externalModules` since Node 20 Lambda runtimes ship the v3 SDK already. The
  `@aws-sdk/client-dynamodb` / `@aws-sdk/util-dynamodb` packages are devDependencies
  purely for local type-checking — don't move them to `dependencies`.
- Aircraft fields from the airplanes.live API use cryptic short names (`alt_baro`, `gs`,
  `nac_p`, ...). Anything persisted to `SeenAircraftTable` or logged is remapped to a
  spelled-out name (`baroAltitudeFt`, `groundSpeedKt`, `positionAccuracyCategory`, ...) —
  see the field mapping table in `lambda/poll-subscriptions.ts`. Keep new fields consistent
  with that naming style rather than carrying the API's abbreviations forward.
- Both DynamoDB tables use `TableV2` with default on-demand billing and
  `RemovalPolicy.DESTROY` (this is a dev-stage project; tighten to `RETAIN` before this is
  ever treated as production data).
- Route/airline enrichment (`lookupRoute` in `poll-subscriptions.ts`) is only fetched once
  per aircraft on first sighting and carried forward via `extractRouteInfo` on later polls —
  don't change this to fetch every poll cycle, it'd multiply calls to adsbdb.com for no
  benefit since route data doesn't change mid-flight.
- Ground/taxiing aircraft (`alt_baro === "ground"`) are filtered out before they're stored or
  logged — the project is specifically about aircraft flying overhead.

## Known limitations (by design, not bugs)

- No subscription CRUD API — subscriptions are added directly via
  `aws dynamodb put-item` (see README).
- No notification delivery — new-aircraft matches are logged to CloudWatch Logs only.
- Route/airline data (`adsbdb.com`) is a callsign→scheduled-route lookup, not tied to a
  specific flight's actual date/time. It can show the wrong route for a delayed flight or a
  reused flight number. This was a deliberate free-tier tradeoff — see conversation history
  or ask before swapping in a paid, date-aware API (e.g. AeroDataBox).

## Working with AWS locally

- Deploys use whatever profile `aws sts get-caller-identity` currently resolves to.
- `npx cdk bootstrap` is required once per account/region before the first deploy.
- After deploying, get actual resource names (they have CDK-generated suffixes) via:
  `aws cloudformation describe-stacks --stack-name TailtrackStack --query "Stacks[0].Outputs"`
