# Safari (macOS)

Safari runs the same extension, converted into a small macOS app by Apple's `safari-web-extension-converter`.
Differences from Chrome/Firefox:
- **No side panel or sidebar:** the toolbar icon opens the full city in a tab (`src/app/surface.ts`). The Lookout
  and the Console Copilot need a panel next to your AWS tab, so they stay Chrome/Edge/Firefox features.
- **No `identity` API:** sign-in opens in a tab and comes back through a static relay page
  (`infra/auth-relay/callback.html`, published to the templates bucket as `AuthRelayUrl`). The extension reads the
  code from that tab and finishes PKCE; the code is useless without the verifier the extension keeps.
- Needs Safari 16.4+ (MV3 service worker, `storage.session`).

## Try it locally

1. `npm run safari:xcode` builds the extension and creates `.cache/safari/AWS City/AWS City.xcodeproj`.
2. Open it in Xcode and press **Run** (⌘R). The app just tells you to enable the extension.
3. Safari → Settings → Advanced → *Show features for web developers*; then Develop → *Allow Unsigned Extensions*
   (needed again after every Safari restart).
4. Safari → Settings → Extensions → tick **AWS City**, and allow it on `console.aws.amazon.com` when asked.
5. Real AWS instead of the demo: `npm run live -- --browser safari`. Safari's extension origin is random, so this
   build carries a one-off token for the local server (never used in hosted mode).

## Publish (Mac App Store)

1. **Apple Developer Program** membership (US$99/year) and Xcode signed in with that team.
2. **Allow Safari to sign in:** `npm run setup`, tick *Safari*. It adds the relay page to Cognito and
   `safari-web-extension://*` to the allowed origins, and writes `WXT_COGNITO_REDIRECT_URL` for the build.
3. `npm run setup` builds `.output/safari-mv3` against your deployment; then `npm run safari:xcode`.
4. In Xcode: set the team, a real bundle id (the default is `dev.awscity.AWS-City`), version and app icon; then
   Product → Archive → Distribute App → App Store Connect.
5. In App Store Connect: listing from [store-listing.md](store-listing.md), privacy details (sign-in email, chat
   messages, AWS page context, screenshots on request — see [privacy-policy.md](privacy-policy.md)), submit.

> Smoke tests run in Chromium only (Playwright can't load Safari extensions); test Safari by hand with the list
> above before each release.
