import { Annotations, CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ack } from './nag.js';
import type { Construct } from 'constructs';
import { type EnvConfig, firefoxRedirectUrl } from './config.js';

/**
 * Player sign-in: a Cognito user pool with email/password and (when configured) Google, managed
 * login, and one public PKCE app client for the extension (chrome.identity.launchWebAuthFlow →
 * https://<extension-id>.chromiumapp.org/). The server verifies access tokens for this client.
 *
 * Signed-in players can let agents change their own AWS account, so:
 *  - step-up MFA: the server refuses to link an AWS account until the player has TOTP on (the extension
 *    enrols it with the aws.cognito.signin.user.admin scope; server/src/accounts/mfa.ts).
 *  - prod runs the Plus plan with threat protection enforced: high-risk sign-ins and leaked passwords are
 *    blocked, medium risk asks for MFA.
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly domainUrl: string;

  /** `authRelayUrl`: the Safari sign-in relay page (DataStack), registered as a callback when env.safari. */
  constructor(scope: Construct, id: string, env: EnvConfig, props?: StackProps & { authRelayUrl?: string }) {
    super(scope, id, props);
    const prod = env.name === 'prod';
    // Without a verified SES sender Cognito sends sign-up and reset emails itself, capped at ~50 a day per account:
    // fine for staging, a launch blocker for prod. A warning, not an error, so synth and CI work before SES is set up
    // (docs/runbook.md, First deploy).
    if (prod && !env.sesFromEmail) {
      Annotations.of(this).addWarning(
        'sesFromEmail is empty: prod sign-up and password-reset emails use Cognito\'s default sender (about 50 a day). Set a verified SES sender before launch.',
      );
    }

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
      featurePlan: prod ? cognito.FeaturePlan.PLUS : cognito.FeaturePlan.ESSENTIALS,
      standardThreatProtectionMode: prod ? cognito.StandardThreatProtectionMode.FULL_FUNCTION : undefined,
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

    // Where Cognito may send the player back, per browser: Chrome/Edge (chromiumapp.org), Firefox (allizom.org,
    // derived from the add-on id) and Safari (the relay page; it has no identity API).
    const callbacks = [
      ...env.extensionIds.map((id) => `https://${id}.chromiumapp.org/`),
      ...(env.firefoxAddonId ? [firefoxRedirectUrl(env.firefoxAddonId)] : []),
      ...(env.safari && props?.authRelayUrl ? [props.authRelayUrl] : []),
    ];
    this.client = this.userPool.addClient('Extension', {
      userPoolClientName: 'aws-city-extension',
      generateSecret: false, // public client: the extension can't keep a secret; PKCE instead
      authFlows: { user: false, userSrp: false, userPassword: false, adminUserPassword: false, custom: false },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        // COGNITO_ADMIN lets the player's own token enrol an authenticator app (AssociateSoftwareToken).
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE, cognito.OAuthScope.COGNITO_ADMIN],
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
    // The extension's build settings (WXT_COGNITO_DOMAIN / WXT_COGNITO_CLIENT_ID).
    new CfnOutput(this, 'CognitoDomain', { value: this.domainUrl });
    new CfnOutput(this, 'CognitoClientId', { value: this.client.userPoolClientId });
    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });

    if (prod) {
      new cognito.CfnUserPoolRiskConfigurationAttachment(this, 'Risk', {
        userPoolId: this.userPool.userPoolId,
        clientId: 'ALL',
        accountTakeoverRiskConfiguration: {
          actions: {
            highAction: { eventAction: 'BLOCK', notify: false },
            mediumAction: { eventAction: 'MFA_IF_CONFIGURED', notify: false },
            lowAction: { eventAction: 'NO_ACTION', notify: false },
          },
        },
        compromisedCredentialsRiskConfiguration: { actions: { eventAction: 'BLOCK' } },
      });
    }

    ack(this.userPool, [
      { id: 'AwsSolutions::AwsSolutions-COG2', reason: 'Step-up MFA: sign-in stays open for learners, but linking an AWS account (the only way to change AWS) needs TOTP, enforced by the server (server/src/accounts/mfa.ts).' },
      ...(prod ? [] : [{ id: 'AwsSolutions::AwsSolutions-COG8', reason: 'Staging uses the Essentials plan; prod runs Plus with threat protection enforced.' }]),
    ]);
  }
}
