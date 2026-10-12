import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { spawnSync } from 'child_process';
import * as path from 'path';

// lambda/ holds only handler.py; layer/ holds requirements.txt
const LAMBDA_DIR = path.join(__dirname, '..', 'lambda');
const LAYER_DIR = path.join(__dirname, '..', 'layer');

// Runs pip on your own PC during `cdk deploy` (no Docker needed)
class PipInstallForLayer implements cdk.ILocalBundling {
  tryBundle(outputDir: string): boolean {
    const python = process.platform === 'win32' ? 'python' : 'python3';

    // Layers must put Python packages in a "python/" folder -> Lambda sees it as /opt/python
    const result = spawnSync(python, [
      '-m', 'pip', 'install',
      '-r', path.join(LAYER_DIR, 'requirements.txt'),
      '-t', path.join(outputDir, 'python'),
      '--platform', 'manylinux2014_x86_64',
      '--implementation', 'cp',
      '--python-version', '3.13',
      '--only-binary=:all:',
      '--upgrade', '--quiet',
    ], { stdio: 'inherit' });

    if (result.status !== 0) {
      console.error(`Layer bundling failed - is "${python}" with pip on your PATH?`);
      return false;
    }
    return true;
  }
}

export class LambdaPackagesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Layer: only the 3 pip packages (+ their dependencies)
    const packagesLayer = new lambda.LayerVersion(this, 'PackagesLayer', {
      layerVersionName: 'lambda-packages-layer',
      description: 'requests, emoji, python-slugify',
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      code: lambda.Code.fromAsset(LAYER_DIR, {
        bundling: {
          image: lambda.Runtime.PYTHON_3_13.bundlingImage,
          local: new PipInstallForLayer(),
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output/python',
          ],
        },
      }),
    });

    // Python Lambda: ships only handler.py, gets packages from the layer
    const packagesFn = new lambda.Function(this, 'PackagesFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.X86_64,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(LAMBDA_DIR),
      layers: [packagesLayer],
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });

    // API Gateway: gives us a public URL to call from Postman
    const api = new apigw.LambdaRestApi(this, 'PackagesApi', {
      handler: packagesFn,
      proxy: false,
      restApiName: 'lambda-packages-api',
    });
    const packages = api.root.addResource('packages');
    packages.addMethod('POST');
    packages.addMethod('GET');

    new cdk.CfnOutput(this, 'PackagesUrl', { value: `${api.url}packages` });
    new cdk.CfnOutput(this, 'LayerArn', { value: packagesLayer.layerVersionArn });
  }
}