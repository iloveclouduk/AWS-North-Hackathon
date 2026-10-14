# Publish to Firefox Add-ons (AMO)

AWS City runs in Firefox 140+ as a **sidebar** (the same app as Chrome's side panel). The add-on id is fixed
(`aws-city@aws-city.dev`, `scripts/extension-id.mjs`, override with `WXT_FIREFOX_ADDON_ID`) because Firefox derives
the sign-in redirect URL from it: `https://<sha1 of the id>.extensions.allizom.org/`.
`node scripts/extension-id.mjs` prints both.

1. **Allow Firefox to sign in.** Run `npm run setup` and tick *Firefox*. The wizard adds the redirect URL to
   Cognito, `moz-extension://*` to the server's allowed origins and to the screenshot bucket's CORS (Firefox gives
   every install a random origin, so players are identified by their sign-in token, not the origin).
2. **Build.** `npm run zip:firefox` (or tag a release: the *release* workflow attaches both files):
   - `.output/aws-city-<version>-firefox.zip` — the add-on;
   - `.output/aws-city-<version>-sources.zip` — the source AMO reviewers rebuild it from (`npm ci && npm run zip:firefox`).
3. **Check it.** `npm run lint:firefox` runs Mozilla's add-on linter (0 errors expected; the warnings come from
   bundled libraries and are explained in the reviewer notes below).
4. **Developer account.** Sign in at https://addons.mozilla.org/developers/ (free).
5. **Submit a new add-on.** Upload the add-on zip, then the sources zip when asked, and fill in:
   - listing text and screenshots from [store-listing.md](store-listing.md);
   - privacy policy: the published [privacy-policy.md](privacy-policy.md);
   - **data collection**: the manifest already declares it (`data_collection_permissions` in `wxt.config.ts`):
     sign-in details, chat messages to the agents, the AWS page you're on, and Lookout screenshots / console labels;
   - reviewer notes: "Built with WXT (`npm ci && npm run zip:firefox`, Node 24). `innerHTML`/`Function` warnings are in
     the bundled Phaser game engine and React. A test account is available on request."
6. **Review** usually takes a few days. Updates: bump `version` in `package.json`, rebuild, upload both zips.

## Testing locally

- Demo mode: `npm run dev:firefox` (WXT opens Firefox with the add-on loaded and reloads on save).
- Real AWS: `npm run live -- --browser firefox`. It pins the add-on's internal UUID with a Firefox preference, so
  the local server can allow exactly that origin.
