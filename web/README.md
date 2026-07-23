# tailtrack web

Vite + React + TypeScript frontend for tailtrack. Enter a location (typed, geocoded via
Nominatim, or your current location via the browser) and a radius, and see aircraft currently
in range on a live Leaflet map plus detail cards. See the repo root `README.md` for how this
gets deployed (S3 + CloudFront) and `CLAUDE.md` for the backend it talks to.

## Local development

```bash
npm install
npm run dev
```

Note `npm run dev` talks to `/api/*` as a relative path — that only resolves once deployed
behind the CloudFront distribution (see root README). There's no local proxy to the deployed
Lambda set up yet.

## Build

```bash
npm run build
```

Outputs to `dist/`, which the root CDK stack's `BucketDeployment` uploads to S3. Build this
*before* running `cdk deploy` from the repo root (or use the root `npm run deploy` script,
which does both).
