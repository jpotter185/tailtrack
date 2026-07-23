# tailtrack

Looks up aircraft flying over a location right now, and shows them in a web app: enter a
location (typed, or your current location) and a radius, and see the aircraft currently in
range on a live map plus detail cards. Under the hood it queries
[airplanes.live](https://airplanes.live) for aircraft in range, filters out anything still on
the ground, and enriches each result with airline/route info looked up from
[adsbdb.com](https://api.adsbdb.com) by callsign.

## How it works

- **`GetFlights`** (Lambda) — looks up aircraft for a `lat`/`lon`/radius (`radiusNm` or
  `radiusMiles`), returning each aircraft's position/altitude/speed fields (renamed to
  human-readable names), any route info found for its callsign, and a `flightRadarUrl`
  linking to that flight on FlightRadar24 (omitted for aircraft with no callsign — mostly
  private/GA flights). Exposed via a Lambda Function URL, but that URL is **not** meant to be
  called directly — see [Access control](#access-control) below.
- **`web/`** — the Vite + React frontend. See `web/README.md` for local dev.
- Both are served from one CloudFront distribution: `/` (and other static paths) → the built
  frontend in a private S3 bucket, `/api/*` → the `GetFlights` Function URL. Since the UI and
  API share an origin, the frontend just calls `/api/flights?...` with no CORS setup needed.

Known limitation: route/airline data comes from a callsign→schedule lookup, not a live flight
plan, so it can be wrong for delayed flights or reused flight numbers.

## Access control

The Function URL's auth type is `AWS_IAM`, and the CloudFront distribution's `/api/*` origin
uses Origin Access Control (OAC) — CloudFront signs requests to the Lambda on its own behalf,
and the Lambda's resource policy only grants invoke permission to *that specific
distribution*. Anyone can use the deployed site (there's no login/API key), but nobody can
call the Lambda directly, bypassing CloudFront and the UI. This is all wired up by CDK
(`origins.FunctionUrlOrigin.withOriginAccessControl(...)`) — no manual IAM policy to write or
secret to manage.

(An earlier iteration of this project required an `x-api-key` header checked against an SSM
parameter. That's gone now that OAC handles access control at the AWS level. If you created
`/tailtrack/api-key` in SSM before, it's unused and safe to delete: `aws ssm delete-parameter
--name /tailtrack/api-key`.)

## Custom domain

The site is served at `tailtrack.tallyo.us` (hardcoded as `DOMAIN_NAME` in
`lib/tailtrack-stack.ts`) instead of the raw `*.cloudfront.net` domain. This needs two things
CDK can't do on its own, since tallyo.us's DNS isn't hosted on Route 53:

1. **An ACM certificate in `us-east-1`** — CloudFront only accepts certs from that region,
   regardless of which region the rest of this stack deploys to. One-time setup:

   ```bash
   aws acm request-certificate \
     --domain-name tailtrack.tallyo.us \
     --validation-method DNS \
     --region us-east-1
   ```

   Then fetch the validation record you need to add at your DNS provider:

   ```bash
   aws acm describe-certificate --region us-east-1 --certificate-arn <ARN from above> \
     --query "Certificate.DomainValidationOptions[0].ResourceRecord"
   ```

   Add that as a CNAME record with your DNS provider (Namecheap/Cloudflare/etc.) and leave it
   in place permanently — ACM reuses it for automatic renewal, not just initial issuance.
   Validation can take anywhere from a few minutes to a few hours after the record propagates.

2. **`CERTIFICATE_ARN`** set in your shell before deploying — `bin/tailtrack.ts` reads it and
   fails fast with a clear error if it's missing:

   ```bash
   export CERTIFICATE_ARN=<ARN from step 1, once ISSUED>
   ```

3. **After deploying**, point `tailtrack.tallyo.us` at CloudFront with one more manual DNS
   record — a CNAME to the `CloudFrontDomainName` stack output (see
   [Deploying](#deploying)).

## Prerequisites

- Node.js and npm
- AWS credentials configured (`aws sts get-caller-identity` should succeed)
- The target AWS account/region bootstrapped for CDK (`npx cdk bootstrap`, one-time)
- `CERTIFICATE_ARN` set (see [Custom domain](#custom-domain) — required, `cdk synth`/`deploy`
  will fail without it)

## Useful commands

* `npm run build`     type-check the CDK app
* `npm run watch`     watch for changes and type-check
* `npm run test`      run the jest unit tests
* `npx cdk synth`     emit the synthesized CloudFormation template
* `npx cdk diff`      compare deployed stack with current state
* `npm run deploy`    build the web app, then `cdk deploy` (does both steps in order)
* `npx cdk deploy`    deploy without rebuilding the web app (only if `web/dist` is already
  current)

## Deploying

The web app has to be built *before* `cdk deploy`, since the stack's `BucketDeployment`
uploads whatever's in `web/dist`:

```bash
npm --prefix web install   # first time only
npm run deploy              # builds web/, then cdk deploy
```

Stack outputs (including `SiteUrl`, the CloudFront URL to open in a browser) are printed
after `cdk deploy`, or fetch them any time with:

```bash
aws cloudformation describe-stacks --stack-name TailtrackStack --query "Stacks[0].Outputs"
```
