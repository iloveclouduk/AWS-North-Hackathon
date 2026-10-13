# AWS City — Privacy Policy

*Last updated: 11 October 2026*

AWS City is a learning game (a browser extension for Chrome, Edge, Firefox and Safari) that teaches Amazon Web Services. This page explains
what the game stores, why, and how to delete it. We don't sell data, show ads, or use your data to
train AI models.

## What we store

| Data | Why | Where / how long |
|---|---|---|
| Your account id from sign-in (a random Cognito id) and email address | So you can sign in and keep your city on any computer | Amazon Cognito, until you delete your account |
| Your city progress (discovered landmarks, XP) | To save your game | Amazon DynamoDB, until you delete your account |
| Your AWS account link: account id, role name, region and a random setup code (ExternalId) | So agents can build in *your* AWS account after you approve | DynamoDB, until you delete your account or the AWSCity stack |
| Your linked AWS account's month-to-date cost totals, by service and Region (only if you turn the city's bill on; off by default) | So the city can show what your account costs this month | DynamoDB, replaced by the next read (at most once a day) and deleted when you delete your account |
| Request counts per minute from your linked AWS account's CloudWatch (load balancer, Lambda, API Gateway, DynamoDB writes), only if you turn live traffic on (off by default) | So the city's traffic can follow your real requests | In the server's memory only, replaced by the next read (at most every 5 minutes) and gone when you close the city |
| A daily count of AI requests | To keep the free tier fair (a daily limit) | DynamoDB, expires after 2 days |
| Screenshots you choose to send to the Lookout | So it can tell you what the page is about | Amazon S3, deleted automatically after 1 day |

**We never see or store your AWS password or access keys.** Agents act in your AWS account only
through the narrow `AWSCityPlayerRole` you install yourself, and only after you press **Approve** in
the game. You can remove that access at any time by deleting the `AWSCity` stack in CloudFormation.

## What we process but don't keep

- **Your questions and requests** are sent to Claude (an AI model) on Amazon Bedrock to produce the
  agents' answers. Amazon Bedrock doesn't store them or use them to train models.
- **Names of the resources in your linked AWS account** (e.g. bucket and table names) are read so
  the city can draw them, and so are your account's Availability Zone names and IDs and which AWS Regions it has turned
  on. They're kept in the server's memory while you're playing, not saved.
- **Console Copilot:** when *you* start it on an AWS Console page, the extension reads the labels of
  the buttons and fields on that page (never their values, never password or secret fields) and
  sends them to the server so the agent can pick the next step. Account ids, access keys and email
  addresses are removed before anything leaves the page.
- **AWS's public status and news:** the server reads the public AWS Health Dashboard and AWS What's New feeds itself,
  once for all players. Nothing about you, your account or your city is sent to fetch them.
- **Server logs** record errors and counts, never your questions, page contents, tokens or keys;
  players appear only as a one-way hash. Logs are kept for 30 days.

## Network and security logs (your IP address)

Like most web services, the infrastructure in front of the server logs each request, including your **IP
address**. We use these logs only to keep the service secure and working (blocking abuse, investigating
incidents), not to track you.

| Log | What it contains | Kept for |
|---|---|---|
| Web firewall (AWS WAF) logs | Each request's IP address, country, URL and request headers (such as your browser's user agent), and whether it was allowed or blocked. Sign-in tokens are removed (`Authorization` and `Sec-WebSocket-Protocol` headers are redacted). | 30 days |
| Access logs (Amazon CloudFront, the load balancer, and the S3 buckets that hold screenshots and the setup template) | IP address, time, the address requested, the response, and the user agent | 90 days |
| Network flow logs (inside our AWS network) | Source and destination IP addresses and ports of connections, no contents | 30 days |

## Browser permissions

- `storage`: save your settings and sign-in on this computer.
- `tabs` / `activeTab`: know which AWS page you're on so the city can show that service, and let the
  Lookout take a screenshot when you ask (or, with auto-snap on, of AWS Console and docs pages only;
  other sites' addresses and titles are never sent).
- `identity`: sign in with Cognito / Google.
- `sidePanel`: show the city next to the page.
- Access to `*.console.aws.amazon.com`: the Console Copilot, only while you run it.
- Optional `<all_urls>`: asked for only if you use the Lookout on a page where `activeTab` isn't enough.

## Deleting your data

In the game: **Deploy → Delete my account**. This deletes your progress, account link, cached bill and sign-in
(`DELETE /me`) from the live database immediately; screenshots expire within a day anyway. Then delete the
`AWSCity` stack in your AWS account's CloudFormation console to remove the role.

**Backups.** So that a fault can't wipe everyone's progress, the database keeps point-in-time recovery and a
daily backup. Both hold copies for at most **35 days**, so your deleted data is gone from every backup within
35 days of deletion. Backups are only used to restore the service after an incident. The network and security
logs above age out on their own schedule (30 or 90 days).

## Contact

Questions: open an issue at https://github.com/iloveclouduk/AWS-North-Hackathon.
