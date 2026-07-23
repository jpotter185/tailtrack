import * as path from "node:path";
import * as cdk from "aws-cdk-lib/core";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";

const DOMAIN_NAME = "tailtrack.tallyo.us";

export interface TailtrackStackProps extends cdk.StackProps {
  // Must be a certificate for DOMAIN_NAME issued in us-east-1 — CloudFront
  // only accepts ACM certificates from that region, regardless of which
  // region this stack itself deploys to. Created out-of-band (see README);
  // DNS for tallyo.us isn't in Route 53, so CDK can't request/validate it.
  certificateArn: string;
}

export class TailtrackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TailtrackStackProps) {
    super(scope, id, props);

    const getFlightsFunction = new NodejsFunction(this, "GetFlights", {
      entry: path.join(__dirname, "../lambda/get-flights-for-location.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(50),
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    // AWS_IAM (rather than NONE) is required for CloudFront Origin Access
    // Control to be the only thing that can invoke this URL — see the OAC
    // origin below, which signs requests on CloudFront's behalf and grants
    // it (and only it) invoke permission.
    const functionUrl = getFlightsFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    new cdk.CfnOutput(this, "GetFlightsFunctionName", {
      value: getFlightsFunction.functionName,
    });

    const siteBucket = new s3.Bucket(this, "WebAppBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, "ApiOriginRequestPolicy", {
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.none(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });

    const certificate = acm.Certificate.fromCertificateArn(this, "Certificate", props.certificateArn);

    const distribution = new cloudfront.Distribution(this, "WebAppDistribution", {
      domainNames: [DOMAIN_NAME],
      certificate,
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiOriginRequestPolicy,
        },
      },
    });

    // FunctionUrlOrigin.withOriginAccessControl() above already grants
    // CloudFront invoke permission scoped to this distribution, but its
    // auto-generated permission doesn't set FunctionUrlAuthType — AWS's own
    // docs/CLI examples for this exact setup (OAC + AWS_IAM Function URL)
    // include it, so add it explicitly here too.
    getFlightsFunction.addPermission("InvokeFromCloudFrontUrl", {
      principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunctionUrl",
      sourceArn: `arn:${cdk.Aws.PARTITION}:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${distribution.distributionId}`,
      functionUrlAuthType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // As of October 2025, AWS requires *both* InvokeFunctionUrl and plain
    // InvokeFunction permissions for CloudFront OAC to invoke a (newly
    // created) Function URL — granting only InvokeFunctionUrl (above) 403s.
    getFlightsFunction.addPermission("InvokeFromCloudFront", {
      principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:${cdk.Aws.PARTITION}:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${distribution.distributionId}`,
    });

    new s3deploy.BucketDeployment(this, "DeployWebApp", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../web/dist"))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new cdk.CfnOutput(this, "SiteUrl", {
      value: `https://${DOMAIN_NAME}`,
    });

    // Point a CNAME for DOMAIN_NAME at this value (see README) — tallyo.us's
    // DNS isn't in Route 53, so this record has to be added manually.
    new cdk.CfnOutput(this, "CloudFrontDomainName", {
      value: distribution.distributionDomainName,
    });
  }
}
