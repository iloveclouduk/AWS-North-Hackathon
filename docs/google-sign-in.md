# Add "Sign in with Google" (optional, ~3 minutes)

Email + password sign-in always works. Google is an extra button on the same Cognito sign-in page.
`npm run setup` shows these exact steps with your real addresses filled in.

You need your **sign-in page address**: `https://<sign-in name>.auth.<region>.amazoncognito.com`.
The wizard prints it, and it's also the `CognitoDomain` output of the `AWSCity-<env>-Auth` stack.

1. Open https://console.cloud.google.com/ and create (or pick) a project, e.g. *AWS City*.
2. Set up the **OAuth consent screen**. The first time, it asks for:
   - User type: **External**. App name: **AWS City**. Your support email.
   - Scopes: the defaults `openid`, `email` and `profile` are enough.
   - Publishing status: while it's *Testing*, only the test users you add can sign in. Choose
     **Publish app** when you go public.
3. Go to **Credentials**, then **Create credentials**, then **OAuth client ID**:
   - Application type: **Web application**. Name: **AWS City**.
   - **Authorised JavaScript origins:** `https://<sign-in name>.auth.<region>.amazoncognito.com`
   - **Authorised redirect URIs:** `https://<sign-in name>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
   - Click **Create** and copy the **Client ID** and **Client secret**.
4. Run `npm run setup` and answer **yes** to Google sign-in.
   - Paste the Client ID.
   - Paste the secret at the hidden prompt. It goes straight into AWS Secrets Manager as
     `aws-city/google-oauth` and is never written to a file.
5. The wizard redeploys. The sign-in page now shows **Continue with Google**.

**Rotating the secret:** create a new secret in Google, then run `npm run setup` and choose
*Replace it*.
**Removing Google:** run `npm run setup` and answer **no**.
