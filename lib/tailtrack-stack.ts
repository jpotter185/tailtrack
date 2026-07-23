import * as path from "node:path";
import * as cdk from "aws-cdk-lib/core";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as kms from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

const API_KEY_PARAMETER_NAME = "/tailtrack/api-key";

export class TailtrackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const getFlightsFunction = new NodejsFunction(this, "GetFlights", {
      entry: path.join(__dirname, "../lambda/get-flights-for-location.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(50),
      environment: {
        API_KEY_PARAMETER_NAME,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    // The API key itself is created out-of-band via `aws ssm put-parameter`
    // (see README) rather than through CDK, so it never appears in the
    // CloudFormation template. SecureString params are encrypted with the
    // default AWS-managed key unless told otherwise, so grant decrypt on
    // that key explicitly (StringParameter.grantRead only adds a KMS grant
    // when an explicit encryptionKey is supplied).
    const ssmDefaultKey = kms.Alias.fromAliasName(this, "SsmDefaultKey", "alias/aws/ssm");
    const apiKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(this, "ApiKeyParam", {
      parameterName: API_KEY_PARAMETER_NAME,
      encryptionKey: ssmDefaultKey,
    });
    apiKeyParam.grantRead(getFlightsFunction);

    new cdk.CfnOutput(this, "GetFlightsFunctionName", {
      value: getFlightsFunction.functionName,
    });

    const functionUrl = getFlightsFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, "GetFlightsUrl", {
      value: functionUrl.url,
    });
  }
}
