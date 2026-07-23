# tailtrack

Looks up aircraft flying over a location right now. Give it a lat, lon, and radius (nm), and
it queries [airplanes.live](https://airplanes.live) for aircraft in range, filters out
anything still on the ground, and enriches each result with airline/route info looked up from
[adsbdb.com](https://api.adsbdb.com) by callsign.

## How it works

- **`GetFlights`** (Lambda) — the only resource in the stack. Exposed via a Lambda Function
  URL, gated by a required `x-api-key` header (see [API key](#api-key) below). Accepts `lat`,
  `lon`, and either `radiusNm` or `radiusMiles` as query string params, and returns the
  current aircraft in range, each with its raw position/altitude/speed fields (renamed to
  human-readable names), any route info found for its callsign, and a `flightRadarUrl`
  linking to that flight on FlightRadar24 (omitted for aircraft with no callsign — mostly
  private/GA flights).

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

## API key

The Function URL has no AWS-native auth (Function URLs don't support API Gateway-style API
keys) — instead, the handler checks an `x-api-key` header against a value stored in SSM
Parameter Store as a `SecureString`. There's no CRUD API for it, same as other one-off config
in this project — create it directly:

```bash
aws ssm put-parameter \
  --name "/tailtrack/api-key" \
  --type SecureString \
  --value "$(openssl rand -hex 32)"
```

Save the generated value somewhere — SSM won't show it back to you except via `get-parameter
--with-decryption`. To rotate it, `put-parameter ... --overwrite` with a new value; the
Lambda caches the key per execution environment, so it can take up to the container's
lifetime to pick up a rotated value (cold starts always fetch fresh).

## Invoking it

Plain `GET` request to the function URL with the API key in a header. `lat` and `lon` are
required; radius accepts either `radiusNm` or `radiusMiles` (exactly one is required):

```bash
curl -H "x-api-key: <your key>" \
  "<GetFlights function URL, from stack outputs>?lat=40.6413&lon=-73.7781&radiusNm=50"
```

Stack output names (function URL, function name) are printed after `cdk deploy`, or fetch
them any time with:

```bash
aws cloudformation describe-stacks --stack-name TailtrackStack --query "Stacks[0].Outputs"
```

curl -H "x-api-key: <your key>" \
  "https://we6763sajfixltezw7cwjw74ge0bylmy.lambda-url.us-east-2.on.aws/?lat=40.6413&lon=-73.7781&radiusNm=50"