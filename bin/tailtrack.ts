#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { TailtrackStack } from '../lib/tailtrack-stack';

const app = new cdk.App();
new TailtrackStack(app, 'TailtrackStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
