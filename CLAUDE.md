# tailtrack

CDK (TypeScript) app with a Lambda that looks up aircraft flying over a given lat/lon/radius,
using the free [airplanes.live](https://api.airplanes.live) ADS-B API, plus a Vite + React
frontend served alongside it via CloudFront. See README.md for the user-facing overview; this
file is oriented at working on the code.

## Structure

- `bin/tailtrack.ts` — CDK app entry point. Stack is pinned to the current CLI's
  account/region via `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION`. Also requires
  `CERTIFICATE_ARN` (throws a clear error if unset) — see [Custom domain](#custom-domain)
  below.
- `lib/tailtrack-stack.ts` — the only stack. Defines the Lambda + Function URL, the S3 bucket
  + `BucketDeployment` for the built frontend, and the CloudFront distribution (aliased to
  `DOMAIN_NAME`) that fronts both.
- `lambda/get-flights-for-location.ts` — on-demand lookup, exposed via a Lambda Function URL.
  Takes `lat`, `lon`, and `radiusNm`/`radiusMiles` as HTTP GET query string params, queries
  airplanes.live, and returns the aircraft in range as JSON. No auth check of its own — access
  control happens at the CloudFront/IAM layer (see below), not in application code.
- `web/` — separate npm project (its own `package.json`, not an npm workspace). Vite + React +
  TypeScript + Leaflet. `web/src/lib/types.ts` mirrors (a trimmed subset of) the Lambda's
  response shape by hand — keep the two in sync manually if you add fields either side cares
  about.

## Conventions

- The Lambda is bundled with `NodejsFunction` (esbuild); `@aws-sdk/*` is marked
  `externalModules` since Node Lambda runtimes ship the v3 SDK already — any `@aws-sdk/*`
  package used at runtime only needs to be a devDependency, never a `dependencies` entry, for
  that reason. The handler must be a **named** export (`export async function handler`), not a
  default export — `NodejsFunction` is configured with `handler: "handler"`, and a default
  export bundles to `exports.default`, which the Lambda runtime won't find
  (`Runtime.HandlerNotFound`).
- Access control: the Function URL's `authType` is `AWS_IAM`, and the CloudFront
  `/api/*` origin is built with `origins.FunctionUrlOrigin.withOriginAccessControl(...)`. That
  CDK helper auto-creates the Origin Access Control resource *and* a `CfnPermission` scoped by
  `sourceArn` to the specific distribution — no manual IAM policy needed, and nothing to
  rotate. Direct calls to the raw Function URL (no valid SigV4 signature from that exact
  distribution) get rejected before the handler ever runs. The frontend and API share one
  CloudFront origin, so browser calls to `/api/...` are same-origin — no CORS configuration on
  the Lambda side.
- The web app has to be built (`npm --prefix web run build`, or `npm run deploy` from the
  root, which does this then `cdk deploy`) before every `cdk deploy` — the stack's
  `BucketDeployment` uploads whatever's currently in `web/dist`. CDK does not build the
  frontend itself (kept simple deliberately, no Docker-based bundling step).
- The root `tsconfig.json` excludes `web/` — it has its own independent tsconfig/build via
  Vite. Don't let the two configs merge; they target very different environments (Node/CDK vs.
  browser/DOM).
- Aircraft fields from the airplanes.live API use cryptic short names (`alt_baro`, `gs`,
  `nac_p`, ...). Everything returned by the handler is remapped to a spelled-out name
  (`baroAltitudeFt`, `groundSpeedKt`, `positionAccuracyCategory`, ...) — see the field mapping
  table in `lambda/get-flights-for-location.ts`. Keep new fields consistent with that naming
  style rather than carrying the API's abbreviations forward.
- Route/airline enrichment (`lookupRoute`) is looked up by callsign from adsbdb.com on every
  invocation, since there's no persistence layer to cache it across calls.
- Ground/taxiing aircraft (`alt_baro === "ground"`) are filtered out before they're returned —
  the project is specifically about aircraft flying overhead.

## Custom domain

`DOMAIN_NAME` (`tailtrack.tallyo.us`) is hardcoded in `lib/tailtrack-stack.ts` and passed to
`Distribution` as `domainNames`, along with a `certificate` imported by ARN
(`acm.Certificate.fromCertificateArn`) — the ARN comes in via the stack's `certificateArn`
prop, sourced from `bin/tailtrack.ts` reading `CERTIFICATE_ARN`. The certificate itself is
**not** managed by CDK: tallyo.us's DNS is external (not Route 53), so there's no hosted zone
for CDK to auto-validate a `certificatemanager.Certificate` against. It's requested and
DNS-validated manually once (see README), and only its ARN — a stable reference, not a
secret — is threaded through the app. Don't try to "fix" this by switching to a CDK-managed
`Certificate` construct unless DNS also moves to Route 53; it'll just hang waiting for
validation CDK can't perform.

## Known limitations (by design, not bugs)

- No persistence — every invocation does a fresh lookup and a fresh route enrichment call per
  aircraft; there's no "new arrivals only" diffing (that existed in an earlier iteration and
  was cut for simplicity).
- The deployed site is open to anyone with the CloudFront URL — no login, no API key. Only
  direct access to the Lambda is restricted (to CloudFront itself). Fine for a dev-stage,
  personal-use project; add real auth (Cognito, etc.) in front of the site if that changes.
- Route/airline data (`adsbdb.com`) is a callsign→scheduled-route lookup, not tied to a
  specific flight's actual date/time. It can show the wrong route for a delayed flight or a
  reused flight number. This was a deliberate free-tier tradeoff — ask before swapping in a
  paid, date-aware API (e.g. AeroDataBox).
- Geocoding (typed location → lat/lon, in `web/src/lib/geocode.ts`) uses OpenStreetMap
  Nominatim directly from the browser — free and keyless, but rate-limited (~1 req/sec) and
  not intended for high-volume use. Fine here; revisit if usage grows.

## Working with AWS locally

- Deploys use whatever profile `aws sts get-caller-identity` currently resolves to.
- `npx cdk bootstrap` is required once per account/region before the first deploy.
- After deploying, get the actual resource names/URLs (CDK-generated suffixes) via:
  `aws cloudformation describe-stacks --stack-name TailtrackStack --query "Stacks[0].Outputs"`
