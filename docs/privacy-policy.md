# AWS City — Privacy Policy

*Last updated: 26 September 2026*

AWS City is a learning game (a Chrome extension) that teaches Amazon Web Services. This page explains
what the game stores, why, and how to delete it. We don't sell data, show ads, or use your data to
train AI models.

## What we store

| Data | Why | Where / how long |
|---|---|---|
| Your account id from sign-in (a random Cognito id) and email address | So you can sign in and keep your city on any computer | Amazon Cognito, until you delete your account |
| Your city progress (discovered landmarks, XP) | To save your game | Amazon DynamoDB, until you delete your account |
| Your AWS account link: account id, role name, region and a random setup code (ExternalId) | So agents can build in *your* AWS account after you approve | DynamoDB, until you delete your account or the AWSCity stack |
| A daily count of AI requests | To keep the free tier fair (a daily limit) | DynamoDB, expires after 2 days |
| Screenshots you choose to send to the Lookout | So it can tell you what the page is about | Amazon S3, deleted automatically after 1 day |

**We never see or store your AWS password or access keys.** Agents act in your AWS account only
through the narrow `AWSCityPlayerRole` you install yourself, and only after you press **Approve** in
the game. You can remove that access at any time by deleting the `AWSCity` stack in CloudFormation.

## What we process but don't keep

- **Your questions and requests** are sent to Claude (an AI model) on Amazon Bedrock to produce the
  agents' answers. Amazon Bedrock doesn't store them or use them to train models.
- **Names of the resources in your linked AWS account** (e.g. bucket and table names) are read so
  the city can draw them. They're kept in the server's memory while you're playing, not saved.
- **Console Copilot:** when *you* start it on an AWS Console page, the extension reads the labels of
  the buttons and fields on that page (never their values, never password or secret fields) and
  sends them to the server so the agent can pick the next step. Account ids, access keys and email
  addresses are removed before anything leaves the page.
- **Server logs** record errors and counts, never your questions, page contents, tokens or keys;
  players appear only as a one-way hash. Logs are kept for 30 days.

## Browser permissions

- `storage`: save your settings and sign-in on this computer.
- `tabs` / `activeTab`: know which AWS page you're on so the city can show that service, and let the
  Lookout take a screenshot when you ask.
- `identity`: sign in with Cognito / Google.
- `sidePanel`: show the city next to the page.
- Access to `*.console.aws.amazon.com`: the Console Copilot, only while you run it.
- Optional `<all_urls>`: asked for only if you use the Lookout on a page where `activeTab` isn't enough.

## Deleting your data

In the game: **Deploy → Delete my account**. This deletes your progress, account link and sign-in
(`DELETE /me`); screenshots expire within a day anyway. Then delete the `AWSCity` stack in your
AWS account's CloudFormation console to remove the role.

## Contact

Questions: open an issue at https://github.com/iloveclouduk/AWS-North-Hackathon.
