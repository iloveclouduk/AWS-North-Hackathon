<div align="center">

<img src="docs/images/terminal.webp" alt="AWS City in the terminal: the title over a night skyline of AWS landmarks, with Lambda, S3, EC2, VPC and Bedrock vehicles driving by" width="760">

# 🏙️ AWS City

### Learn AWS by living in it.

**🏆 1st place, North Hackathon at Northumbria University**
<!-- TODO: add the date, the prize and the team's names, e.g. "October 2026 · Team: …" -->

[![CI](https://github.com/iloveclouduk/AWS-North-Hackathon/actions/workflows/ci.yml/badge.svg)](https://github.com/iloveclouduk/AWS-North-Hackathon/actions/workflows/ci.yml)
![Node 24+](https://img.shields.io/badge/node-24%2B-339933?logo=nodedotjs&logoColor=white)
![Chrome · Edge · Firefox · Safari](https://img.shields.io/badge/browsers-Chrome%20%C2%B7%20Edge%20%C2%B7%20Firefox%20%C2%B7%20Safari-4285F4)
![Built on AWS](https://img.shields.io/badge/built%20on-AWS-FF9900?logo=amazonwebservices&logoColor=white)
![Claude on Amazon Bedrock](https://img.shields.io/badge/agents-Claude%20on%20Amazon%20Bedrock-D97757)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A browser extension with a living isometric pixel city, where **every AWS service is a place** and its agent does
that service's real job. The more you learn, the taller your city grows.

[**▶ Play in 2 minutes**](#for-kids-and-parents-the-quick-path) · [Run it on your AWS](#2--run-it-on-your-own-aws-one-command) · [How it works](#how-it-works)

</div>

<p align="center"><img src="docs/images/city-night.webp" alt="A grown AWS City at night: knowledge towers in each district's colour, the river, the AZ islands and the lake" width="900"></p>

---

## Welcome to the city

You are **Kai**, in the team's gold jacket. Every building is an AWS service, and its agent works there:
- Sally fishes objects out of **S3 Lake**.
- Sir Shieldon blocks DDoS arrows at the **Shield Wall**.
- Ruby pairs DNS dancers at the **Route 53 Dance Hall**.
- Lola only cooks when an order arrives at the **Lambda Food Stall**.

Browse the AWS Console and the city grows with you: open a service's page and its building goes up.

### 🌆 Your knowledge, made tall

Every building grows with what you learn there. A **Novice** starts small. At **Practitioner** a tower in its
district's colour rises behind it. **Expert** adds a setback storey, and **Master** is a skyscraper with the
district's crown and a beacon. The building rises floor by floor when you level it up.

Past Master, stars aren't enough. Three **gold crowns** (Mentor, Architect, Legend) are earned only with real
knowledge: cards you remember for a week, a passed architecture drawing, a finished quest and rounds of the game.
The Legend's crown shines a beam over the city at night.

<p align="center"><img src="docs/images/growth.webp" alt="S3 Lake and the DynamoDB Library from Novice to Master, then wearing one, two and three gold crowns" width="760"></p>

<p align="center"><img src="docs/images/legend.webp" alt="S3 Lake reaches Level 7, Legend: Sally cheers &quot;A Legend crown! You really know this&quot; and the card shows three crowns" width="900"></p>

### 🚶 A city to explore

- **Walk there.** A quest's visit counts when Kai arrives, and "Go →" walks him over.
- **Citizens ask for help.** A gold **?** over a passer-by means a quick AWS question. Answer it and that building grows.
- **Six golden tokens** are hidden on every city's streets. They glint only when you're close.
- **re:Play Park** rides open as your buildings level up. Tap one and Kai hops on.
- **Each AWS Region is its own city**, built from real facts: its Availability Zones are islands across the river.

### 🎮 Play, learn, grow

- **6 mini-games**, each built for one service: S3 fishing, the Lambda kitchen, the Route 53 dance, the Shield wall,
  EC2 rush hour and the DynamoDB sorting office. Questions get harder as you play, and an Expert round opens at level 3.
- **300 flashcards** with spaced repetition, in simple words first and the full answer one tap away.
- **Architecture puzzles** scored on the 6 Well-Architected pillars, including a "Region goes dark" drill.
- **22 quests** that together cover all 36 services, each ending with *Explain it back*.
- **Today**: a few cards, a puzzle, a game and a fix keep your streak alive.

<p align="center"><img src="docs/images/mini-games.webp" alt="Four mini-games: S3 fishing, the Lambda food stall, the Route 53 dance hall and the Shield wall" width="760"></p>

### ☁️ Real AWS, safely

- **Ask anything.** The agents answer in plain words, grounded in the official AWS docs, with links.
- **Console Copilot.** Tick *Do it in my console* and an agent walks you through real AWS Console pages. It highlights
  each button and explains why, and risky buttons are always your click.
- **Build for real.** Connect *your own* AWS account with a small, restricted role. Every change waits for your
  **Approve**.
- **City care.** Citizens spot real issues in your account (a public bucket, a table without backups) and explain
  the fix. You approve each one.
- **Live AWS status.** Real outages from the public AWS Health Dashboard arrive as a news ticker, a throbbing Region on
  the world map, and storms over that Region's city (for example, Bahrain's 2026 disruption).

| | |
|---|---|
| <img src="docs/images/deploy-approve.webp" alt="A deploy preview waiting for the player's Approve"> | <img src="docs/images/aws-status.webp" alt="A storm over the Bahrain city during a real AWS Health event"> |
| **Every change waits for your Approve** | **Real AWS status, as weather** |

### 📸 Screenshots

| | |
|---|---|
| [<img src="docs/images/shots/agent-at-work.webp" alt="Connie dispatches Sally the Angler; the panel shows her 5-step S3 task to store holiday photos cheaply">](docs/images/shots/agent-at-work.webp) | [<img src="docs/images/shots/lifecycle-step.webp" alt="Sally sets an S3 lifecycle rule while Ivy checks her badge allows s3:PutObject only">](docs/images/shots/lifecycle-step.webp) |
| **Agents do the real job.** Ask for something and watch them work, step by step. | **Least privilege, out loud.** Each step names the API call, and the security citizen checks the role. |
| [<img src="docs/images/shots/architecture-puzzle.webp" alt="An architecture puzzle: drag Route 53, CloudFront and S3 onto a diagram of a static website">](docs/images/shots/architecture-puzzle.webp) | [<img src="docs/images/shots/flashcards.webp" alt="An EC2 flashcard about placement groups, with Didn't know, Knew it and Easy buttons">](docs/images/shots/flashcards.webp) |
| **Draw the architecture.** Drop services on a real AWS diagram, scored on the Well-Architected pillars. | **Cards in plain words.** Spaced repetition, with the full answer and AWS docs one tap away. |
| [<img src="docs/images/shots/building-card.webp" alt="The EC2 Factory card: level, progress, Play Rush Hour, Learn with cards and further reading">](docs/images/shots/building-card.webp) | [<img src="docs/images/shots/city-care.webp" alt="Noor the reliability citizen says I spotted a problem, tap me, beside the DynamoDB Library">](docs/images/shots/city-care.webp) |
| **Every building is a lesson.** Its level, its game, its cards and a "which one should I pick?" guide. | **City care.** Citizens spot real issues and explain the fix; you approve each one. |
| [<img src="docs/images/shots/world-map-build.webp" alt="The world map of AWS Regions next to the Build tab's blueprints and practice account">](docs/images/shots/world-map-build.webp) | [<img src="docs/images/shots/letters.webp" alt="The Day 1 Quarter: Amazon's letters to shareholders from 1997, each with an AWS takeaway">](docs/images/shots/letters.webp) |
| **Every Region is a city.** Build from blueprints with a practice account first. | **Day 1 culture.** Letters to Shareholders, the Leadership Principles and Golden Jacket Hall. |
| [<img src="docs/images/shots/expo-hall.webp" alt="The re:Invent Expo Hall: AWS launches by year from S3 in 2006 onwards, and a launch-year quiz">](docs/images/shots/expo-hall.webp) | [<img src="docs/images/citizen-question.webp" alt="A citizen's question card: three answers, the right one ticked, and the building it grew">](docs/images/citizen-question.webp) |
| **re:Invent Expo Hall.** Two decades of launches, and a quest to guess the year. | **Help a citizen.** A quick question in the street grows the building it's about. |

---

## For kids and parents: the quick path

1. Install AWS City from your browser's store (below). The city opens in a tab by itself.
2. Press **Play the demo** at the top. No account, no AWS, nothing real is created or charged.
   When you want to keep your city, open the **⋯** menu and pick **Sign in to save your city**.

No store? With [Node 24+](https://nodejs.org) installed, two lines open the demo in its own browser window:

```bash
git clone https://github.com/iloveclouduk/AWS-North-Hackathon.git && cd AWS-North-Hackathon
npm install && npm run open
```

---

## Get AWS City

| Browser | Install | Opens as |
|---|---|---|
| **Chrome**, Edge, Brave, Opera | Chrome Web Store *(link once published)* | side panel |
| **Firefox** 140+ | Firefox Add-ons *(link once published)* | sidebar |
| **Safari** 16.4+ on macOS | Mac App Store *(link once published)* | full city in a tab (Safari has no side panel, so the Lookout and Console Copilot need Chrome, Edge or Firefox) |

Publishing guides: [Chrome Web Store](docs/chrome-web-store.md) · [Firefox Add-ons](docs/firefox-addons.md) · [Safari](docs/safari.md).

---

## Start here: one command

```bash
git clone https://github.com/iloveclouduk/AWS-North-Hackathon.git && cd AWS-North-Hackathon
npm install
npm start
```

`npm start` draws the city, then asks two things and handles the rest:
1. **How do you want to play?** 🎮 the demo (no AWS) · ☁️ real AWS on this computer · 🚀 put it online for everyone.
2. **Which browser?** It lists the ones you have. *AWS City browser* (Chrome for Testing) opens with the extension
   already loaded; Google Chrome, Edge and Brave take 3 guided clicks (they block auto-loading); Firefox opens with it
   loaded; Safari builds the Xcode project and walks you through enabling it.

For real AWS it connects your account the easy way — **sign in with your browser** (`aws login`, no keys to copy),
**paste the keys** from Workshop Studio (it reads them from your clipboard), or **SSO** — checks Claude on Bedrock,
then starts the local server. It remembers your answers for next time. Nothing needs Docker.

**On stage, or in a hurry**, skip the questions:

```bash
npm start -- --demo --browser cft      # straight to the demo in the AWS City browser, zero clicks
npm start -- --demo --browser chrome   # the same in Google Chrome (edge, brave, firefox, safari work too)
npm start -- --help                    # every option (--live for real AWS, --no-intro to skip the animation)
```

Keep the `--`: without it npm keeps the options for itself. Once the city is open the terminal stays its control
panel: **c** brings the city tab forward, **p** opens the S3 practice page, **a** the real AWS console, **r** reopens
the browser and **q** (or Ctrl-C) closes everything. Click once in the city to turn the sound on: browsers keep a page
quiet until you click it.

## Choose your path (the commands behind `npm start`)

| | You need | Time | Command |
|---|---|---|---|
| **1. Play now** (demo agents, no AWS) | Node 24+ | 2 min | `npm run open` |
| **2. Run it on your own AWS** (real agents, sign-in, alarms) | an AWS account | ~25 min, mostly waiting | `npm run setup` |
| **3. Develop against real AWS locally** | an AWS profile with Bedrock, AWS CLI 2.32+ | 5 min | `npm run live` (`-- --help` lists the options) |

### 1 · Play now

```bash
git clone https://github.com/iloveclouduk/AWS-North-Hackathon.git && cd AWS-North-Hackathon
npm install
npm run open          # builds the extension and opens Chromium with it loaded
```

The first run downloads the AWS City browser (Chrome for Testing, about 150 MB) if it isn't there yet.
The guided `npm start` and the scripts are built for macOS first; on Linux and Windows, use
`npm run build` and load `.output/chrome-mv3` yourself (below).

**Using your own Chrome:**
1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick `.output/chrome-mv3`.

**Other browsers (demo mode):**
- Firefox: `npm run dev:firefox` opens Firefox with the extension; click the toolbar icon for the sidebar.
- Safari: `npm run safari:xcode`, press Run in Xcode, then allow unsigned extensions ([docs/safari.md](docs/safari.md)).

**Getting around:**
- The toolbar icon opens the **side panel**; **⋯ → Open the full city in a tab ↗** opens the full-screen city.
- Move Kai by clicking or with **WASD / arrow keys**, and press **E** to talk or enter.
- **⋯ → Replay the tour** shows the first-run tour again.
- `npm run open` opens the city and a safe S3 practice page. Add `-- --console` to open the real AWS console sign-in too.

### 2 · Run it on your own AWS (one command)

```bash
npm install
npm run setup         # a wizard: asks a few questions, checks everything, deploys, builds the extension
```

**Before you start** (the wizard checks these and tells you exactly what's missing):
1. **An AWS account where you're an admin**, signed in on this computer. Use `aws login`
   (AWS CLI 2.32+), `aws configure sso`, or `export AWS_PROFILE=<profile>`.
2. **Claude on Amazon Bedrock.** Serverless models are enabled on first use, but Anthropic asks each
   account (or organization) for a one-time use-case form: in the Bedrock console, open the **Model catalog**,
   pick a Claude model and submit it. The first call also needs `aws-marketplace:Subscribe` and a payment
   method ([AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)). The wizard
   checks the Region's Claude models (Opus 5.5 and Sonnet 5.5; Opus 5 and Sonnet 5 in India) and tells you how to
   enable them.

**What the wizard asks** (each answer is saved to `aws-city.config.json`, which is gitignored and
contains no secrets):

| Question | Why | If you're not sure |
|---|---|---|
| Environment | `prod` (players) or `staging` (test copy). Both can live in one account. | `staging` first, then `prod` |
| Region | Where it runs. Claude runs through a Bedrock geo inference profile, so only these Regions work: US and Canada (`us.`), Europe (`eu.`), Sydney/Melbourne (`au.`), Mumbai/Hyderabad (`in.`); the wizard lists them (`infra/lib/models.ts`). | `us-west-2` |
| Web address | A Route 53 domain gives `api.yourdomain.com`; otherwise CloudFront gives free HTTPS. | **No domain** |
| Sign-in page name | Your Cognito sign-in address. The wizard checks it's free. | Accept the suggestion |
| Google sign-in | Optional "Sign in with Google" ([guide](docs/google-sign-in.md)). Email + password always works. | Skip; add it later |
| Alarm email | Alarms and budget alerts. Click the confirmation email AWS sends. | Your email |
| Monthly budget | At 100% the AI switches off automatically; everything else keeps working. | 300 (prod) / 50 (staging) |
| SES sender | Optional: your own "from" address for sign-up emails (Cognito's default sends ~50/day). | Skip |
| Allow the local (unpacked) build | Lets the extension you build on this computer sign in. On by default for staging, off for prod. | Default |
| Chrome Web Store id | Only after you publish ([guide](docs/chrome-web-store.md)). Re-run setup to add it. | Leave empty |
| GitHub deploys | Optional CI/CD with GitHub OIDC (no stored keys). | Skip |

**What it does for you:**
1. Asks before every change to AWS.
2. Bootstraps CDK.
3. Deploys the stacks, which takes about 15–25 minutes the first time.
4. Smoke-tests the live API.
5. Writes `.env.production` and builds the extension, plus a store-ready zip.

**When it's done:**
- **Try it (staging):** in `chrome://extensions`, click **Load unpacked** and pick `.output/chrome-mv3`.
- **Publish:** upload `.output/*-chrome.zip` to the Chrome Web Store
  ([guide](docs/chrome-web-store.md)), then run `npm run setup` again and enter the store id.

**Other commands:**
- `npm run setup -- --dry-run`: see every question and check without changing anything in AWS (it still
  writes your answers to `aws-city.config.json`). This also works without an AWS login.
- `npm run setup -- --env staging`: skip the environment question (`--yes` accepts every saved answer).
- `npm run setup -- --destroy --env staging`: remove that environment's stacks. Tables and buckets are kept,
  so no data is lost by accident.

**Cost while idle:**
- **prod:** roughly **$60–85/month** for two small Fargate tasks, the load balancer, WAF and logs.
- **staging:** roughly **$45–60/month**.
- **Claude on Bedrock:** pay per use, capped per player per day and by your budget.

### 3 · Develop against real AWS locally

```bash
npm start                             # pick "Real AWS": signs you in, checks Claude on Bedrock, then runs live
npm run live                          # the same, without the questions: profile aws-city / workshop / default
npm run live -- --profile me --region eu-west-1 --browser firefox
```

The local server listens on `127.0.0.1` only and uses your profile. Each change still needs your
Approve. It picks up refreshed keys within a minute.

---

## How it works

```mermaid
flowchart LR
  subgraph Browser["Browser extension: Chrome, Edge, Firefox, Safari (WXT + React + Phaser)"]
    City["Pixel city + side panel"] --- Copilot["Console Copilot<br/>(content script on console.aws.amazon.com)"]
  end
  City -- "WebSocket + REST<br/>Cognito JWT" --> Edge["CloudFront + edge WAF<br/>(or HTTPS ALB on your domain)"]
  Edge --> ALB["Load balancer<br/>(private)"] --> ECS["ECS Fargate · server/<br/>tenants, approvals, quotas"]
  ECS --> DDB[("DynamoDB<br/>progress, links, quotas")]
  ECS --> S3[("S3<br/>screenshots, 1 day")]
  ECS --> Bedrock["Amazon Bedrock<br/>Claude"]
  ECS --> Docs["AWS Knowledge MCP<br/>(official docs, read-only)"]
  ECS --> Health["AWS Health Dashboard + What's New<br/>(public feeds, read once for everyone)"]
  ECS -- "sts:AssumeRole + ExternalId" --> Player["Player's own account<br/>AWSCityPlayerRole"]
  Cognito["Cognito<br/>email / Google"] -. sign-in .- City
```

**Safety model:**
- **Nothing in AWS changes without your Approve.** An agent's write becomes a preview; policy is
  checked again after you approve.
- **We never hold your keys.** Agents act in your account only through the role you install
  (`infra/player-role/player-role.yaml`). It's least-privilege: tiny, tagged, name-prefixed
  resources, locked to one Region, and it trusts only this deployment's server role. Delete the
  `AWSCity` stack to revoke it.
- **Console Copilot runs only when you start it, only on console pages.** It never clicks
  delete / IAM / billing controls and never reads secret fields; press Esc to stop.
- **Costs are capped.** Each player has a daily AI quota, and there's a kill switch
  (`/aws-city/<env>/ai-enabled`). At 100% of the budget, AI is cut off automatically.
- **Architecture:** [docs/well-architected.md](docs/well-architected.md) is our Well-Architected
  review with evidence. Infra passes the cdk-nag AWS Solutions checks.

## Project tour

```
src/          the extension: app/ (shell), ui/ (panels), game/ (Phaser city), console/ (Copilot), backend/ (the only network I/O)
shared/       content as data: 36 services, flashcards, puzzles, quests, culture, regions
art/          pixel-art generators (characters, city tiles, landmarks) → public/assets
server/       the backend (Node + TS): agents on Bedrock, approvals, tenants, stores — local or hosted
infra/        CDK stacks (data, auth, service, edge WAF, budget, CI) + setup wizard + player role
scripts/      open / live / smoke tests / asset fetchers
docs/         contract, runbook, privacy policy, store listing, Google & Chrome Web Store guides
```

| Command | What it does |
|---|---|
| `npm run check` | Type-check + unit tests (extension), React component tests included |
| `npm run lint` | ESLint: rules of hooks and accessibility (jsx-a11y) |
| `npm run smoke` / `smoke:copilot` | Playwright runs; screenshots in `.output/smoke`; must print "no page errors" |
| `cd server && npm test` | Server tests (auth, tenants, approvals, Copilot, docs grounding, player-role drift) |
| `cd infra && npm test && npx cdk synth -q` | Infra tests + cdk-nag |
| `npm run art` | Regenerate the pixel art |

The backend contract is [docs/backend-contract.md](docs/backend-contract.md); its source of truth is
`src/backend/contract.ts`. Operations (kill switch, alarms, restores, support) are in
[docs/runbook.md](docs/runbook.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Setup: *Bedrock model access is not ready* | Submit Anthropic's one-time use-case form (Bedrock → Model catalog → a Claude model) and check `aws-marketplace:Subscribe` + a payment method; wait a few minutes, then re-run. |
| Setup: *sign-in name is taken* | Pick another name; it can't contain `aws`, `amazon` or `cognito`. |
| Deploy fails building the image | The image is built in AWS CodeBuild: the error links to the build log (CloudWatch → `/aws/codebuild/ContainerImageBuildArm64…`). |
| `npm run dev` shows a blank page | Branded Chrome blocks auto-loading; install the AWS City browser once with `npx playwright install chromium` (or just use `npm start`). |
| No alarm or budget emails | Click **Confirm subscription** in the AWS Notifications email. |
| "Sign in" loops in the extension | That build's extension id isn't allowed: re-run `npm run setup` (allow the local build, or add the store id). |
| "The city's AI is resting" | The kill switch is off or the budget was hit (see the [runbook](docs/runbook.md)). |
| Player can't link their account | Create the stack from the in-game link *in the same Region*, then paste the 12-digit account id. |

## For contributors using Claude Code

This repo uses the official AWS plugins from the [Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws),
enabled in `.claude/settings.json`. Install them once:

```
/plugin install aws-core@claude-plugins-official      # AWS skills (CDK, IAM, containers, networking, security, cost, Well-Architected…)
/plugin install aws-agents@claude-plugins-official    # AWS Knowledge MCP (official docs)
/reload-plugins
```

Note that aws-core's AWS MCP server can call AWS APIs **with your credentials**. It's for your own
development session only, and the game's agents never use it (see `CLAUDE.md`).

## The team

Built at the **North Hackathon at Northumbria University**, where AWS City won **1st place**. 🏆
<!-- TODO: the team's names and links, and a thank-you to the organisers, judges and mentors. -->

## License

The code is [MIT](LICENSE). The AWS Architecture Icons, the Kenney sounds and the fonts keep their own terms (below),
and AWS, Amazon and the service names are trademarks of Amazon.

## Credits

- **Characters:** the team's Habbo-style pixel generator (`art/characters`).
- **City pack:** imported pixel-for-pixel from the team's `agentic-city` prototype (`art/pack`).
- **Everything else:** generated in that style (`art/tiles`).
- **AWS Architecture Icons** © Amazon Web Services, used as provided for architecture diagrams
  (`public/assets/aws-icons/NOTICE`). AWS, Amazon and the service names are trademarks of Amazon.
  AWS City is an independent learning project, not affiliated with or endorsed by Amazon.
- **Fonts:** Nunito and Press Start 2P (OFL).
- **Sounds:** [Kenney](https://kenney.nl), CC0.
- **Learn more reading:** each building links (never copies) to [Tutorials Dojo](https://tutorialsdojo.com/aws-cheat-sheets/)
  cheat sheets, [AWS Fundamentals](https://awsfundamentals.com/blog) articles and its book, and O'Reilly books
  (*AWS Cookbook*, *Serverless Development on AWS*, *Generative AI on AWS*), credited with their authors
  (`shared/further-reading.json`). The game's own cards are in our words and cite AWS docs.

---

<p align="center"><sub>Made with ☕ in Newcastle upon Tyne · <b>Learn AWS by living in it.</b></sub></p>
