# tailtrack

CDK (TypeScript) app with a single Lambda that looks up aircraft flying over a given
lat/lon/radius, using the free [airplanes.live](https://api.airplanes.live) ADS-B API. See
README.md for the user-facing overview; this file is oriented at working on the code.

## Structure

- `bin/tailtrack.ts` — CDK app entry point. Stack is pinned to the current CLI's
  account/region via `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION`.
- `lib/tailtrack-stack.ts` — the only stack. Defines the single Lambda, its Function URL, and
  the SSM parameter reference/IAM grants backing the API key check.
- `lambda/get-flights-for-location.ts` — on-demand lookup, exposed via a Lambda Function URL
  gated by an `x-api-key` header. Takes `lat`, `lon`, and `radiusNm`/`radiusMiles` as HTTP GET
  query string params, queries airplanes.live, and returns the aircraft in range as JSON.

## Conventions

- The Lambda is bundled with `NodejsFunction` (esbuild); `@aws-sdk/*` is marked
  `externalModules` since Node Lambda runtimes ship the v3 SDK already. Any `@aws-sdk/*`
  package used at runtime (e.g. `@aws-sdk/client-ssm`) only needs to be a devDependency, never
  a `dependencies` entry — it's preinstalled in the Lambda runtime and never gets bundled into
  the deployed zip. The handler must be a **named** export (`export async function handler`),
  not a default export — `NodejsFunction` is configured with `handler: "handler"`, and a
  default export bundles to `exports.default`, which the Lambda runtime won't find
  (`Runtime.HandlerNotFound`).
- API key check: the handler fetches the expected key from the SSM parameter named by the
  `API_KEY_PARAMETER_NAME` env var (`SecureString`, decrypted at read time) and compares it to
  the request's `x-api-key` header with `crypto.timingSafeEqual` (not `===`, to avoid a timing
  side-channel on the secret). The fetched value is cached at module scope for the life of the
  execution environment — cleared and retried on failure rather than permanently poisoning the
  container. The parameter itself is created out-of-band via `aws ssm put-parameter` (see
  README), never through CDK, so the key value never lands in the CloudFormation template or
  this repo.
- Aircraft fields from the airplanes.live API use cryptic short names (`alt_baro`, `gs`,
  `nac_p`, ...). Everything returned by the handler is remapped to a spelled-out name
  (`baroAltitudeFt`, `groundSpeedKt`, `positionAccuracyCategory`, ...) — see the field mapping
  table in `lambda/get-flights-for-location.ts`. Keep new fields consistent with that naming
  style rather than carrying the API's abbreviations forward.
- Route/airline enrichment (`lookupRoute`) is looked up by callsign from adsbdb.com on every
  invocation, since there's no persistence layer to cache it across calls.
- Ground/taxiing aircraft (`alt_baro === "ground"`) are filtered out before they're returned —
  the project is specifically about aircraft flying overhead.

## Known limitations (by design, not bugs)

- No persistence — every invocation does a fresh lookup and a fresh route enrichment call per
  aircraft; there's no "new arrivals only" diffing (that existed in an earlier iteration and
  was cut for simplicity).
- Auth is a single shared API key, not per-user credentials — anyone with the key can call it,
  and there's no throttling/quota beyond the Lambda's own concurrency. Fine for a dev-stage,
  free-tier-API-backed project; an API Gateway REST API with native API Key/Usage Plan support
  would be the upgrade path if per-key quotas or rotation tooling are ever needed.
- Route/airline data (`adsbdb.com`) is a callsign→scheduled-route lookup, not tied to a
  specific flight's actual date/time. It can show the wrong route for a delayed flight or a
  reused flight number. This was a deliberate free-tier tradeoff — ask before swapping in a
  paid, date-aware API (e.g. AeroDataBox).

## Working with AWS locally

- Deploys use whatever profile `aws sts get-caller-identity` currently resolves to.
- `npx cdk bootstrap` is required once per account/region before the first deploy.
- After deploying, get the actual function name (it has a CDK-generated suffix) via:
  `aws cloudformation describe-stacks --stack-name TailtrackStack --query "Stacks[0].Outputs"`
