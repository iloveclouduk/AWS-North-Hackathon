import { Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ack } from './nag.js';
import type { Construct } from 'constructs';
import type { EnvConfig } from './config.js';

/**
 * Player sign-in: a Cognito user pool with email/password and (when configured) Google, managed
 * login, and one public PKCE app client for the extension (chrome.identity.launchWebAuthFlow →
 * https://<extension-id>.chromiumapp.org/). The server verifies access tokens for this client.
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly domainUrl: string;

  constructor(scope: Construct, id: string, env: EnvConfig, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'Players', {
      userPoolName: `aws-city-${env.name}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 10, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      email: env.sesFromEmail ? cognito.UserPoolEmail.withSES({ fromEmail: env.sesFromEmail, fromName: 'AWS City', sesRegion: env.region }) : undefined,
      deletionProtection: env.name === 'prod',
      removalPolicy: env.name === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const providers = [cognito.UserPoolClientIdentityProvider.COGNITO];
    let google: cognito.UserPoolIdentityProviderGoogle | undefined;
    if (env.googleClientId) {
      google = new cognito.UserPoolIdentityProviderGoogle(this, 'Google', {
        userPool: this.userPool,
        clientId: env.googleClientId,
        // Put the secret in Secrets Manager yourself: {"clientSecret": "..."} under aws-city/google-oauth.
        clientSecretValue: SecretValue.secretsManager('aws-city/google-oauth', { jsonField: 'clientSecret' }),
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: { email: cognito.ProviderAttribute.GOOGLE_EMAIL, emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED },
      });
      providers.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
    }

    const callbacks = env.extensionIds.map((id) => `https://${id}.chromiumapp.org/`);
    this.client = this.userPool.addClient('Extension', {
      userPoolClientName: 'aws-city-extension',
      generateSecret: false, // public client: the extension can't keep a secret; PKCE instead
      authFlows: { user: false, userSrp: false, userPassword: false, adminUserPassword: false, custom: false },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: callbacks.length ? callbacks : ['https://localhost.invalid/'],
        logoutUrls: callbacks.length ? callbacks : ['https://localhost.invalid/'],
      },
      supportedIdentityProviders: providers,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });
    if (google) this.client.node.addDependency(google);

    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: env.cognitoDomainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    new cognito.CfnManagedLoginBranding(this, 'Branding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.client.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    this.domainUrl = domain.baseUrl();

    ack(this.userPool, [
      { id: 'AwsSolutions::AwsSolutions-COG2', reason: 'MFA is optional (TOTP) for a learning game; players can turn it on.' },
      { id: 'AwsSolutions::AwsSolutions-COG8', reason: 'Essentials plan for launch (threat protection is Plus); revisit at scale.' },
    ]);
  }
}
