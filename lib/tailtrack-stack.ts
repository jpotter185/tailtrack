import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export class TailtrackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Holds user subscriptions: subscriptionId -> { lat, lon, radiusNm }.
    // No CRUD API yet; populate items directly (console/CLI) for now.
    const subscriptionsTable = new dynamodb.TableV2(this, 'SubscriptionsTable', {
      partitionKey: { name: 'subscriptionId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const getAircraftFunction = new NodejsFunction(this, 'GetAircraftFunction', {
      entry: path.join(__dirname, '../lambda/get-aircraft.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: subscriptionsTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    subscriptionsTable.grantReadData(getAircraftFunction);

    // Tracks aircraft already seen per subscription so the poller only
    // reports new arrivals. TTL evicts entries after a gap so a plane that
    // leaves and comes back later is treated as new again.
    const seenAircraftTable = new dynamodb.TableV2(this, 'SeenAircraftTable', {
      partitionKey: { name: 'subscriptionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'icaoHex', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const pollSubscriptionsFunction = new NodejsFunction(this, 'PollSubscriptionsFunction', {
      entry: path.join(__dirname, '../lambda/poll-subscriptions.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(50),
      environment: {
        SUBSCRIPTIONS_TABLE: subscriptionsTable.tableName,
        SEEN_AIRCRAFT_TABLE: seenAircraftTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    subscriptionsTable.grantReadData(pollSubscriptionsFunction);
    seenAircraftTable.grantReadWriteData(pollSubscriptionsFunction);

    new events.Rule(this, 'PollSubscriptionsSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(pollSubscriptionsFunction)],
    });

    new cdk.CfnOutput(this, 'SubscriptionsTableName', {
      value: subscriptionsTable.tableName,
    });

    new cdk.CfnOutput(this, 'GetAircraftFunctionName', {
      value: getAircraftFunction.functionName,
    });

    new cdk.CfnOutput(this, 'PollSubscriptionsFunctionName', {
      value: pollSubscriptionsFunction.functionName,
    });
  }
}
