#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { TailtrackStack } from '../lib/tailtrack-stack';

const certificateArn = process.env.CERTIFICATE_ARN;
if (!certificateArn) {
  throw new Error(
    'CERTIFICATE_ARN environment variable is required (an ACM certificate for tailtrack.tallyo.us, issued in us-east-1) — see README.',
  );
}

const app = new cdk.App();
new TailtrackStack(app, 'TailtrackStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  certificateArn,
});
