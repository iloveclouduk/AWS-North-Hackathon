# Chrome Web Store listing (draft)

**Name:** AWS City — learn AWS in a pixel city

**Summary (≤132 chars):** A living pixel city where friendly agents teach AWS, help in your console step by step, and build safely.

**Category:** Education

**Description:**
AWS City turns Amazon Web Services into a cosy pixel city. Every service is a place with an agent
who does its job: Sally fishes objects out of S3 Lake, Sir Shieldon guards the Shield Wall, Eddie
rents out computers at the EC2 Factory.

- Browse the AWS Console and the city grows with you.
- Ask anything: agents answer in plain words, grounded in the official AWS documentation, with links.
- Console Copilot: tick "Do it in my console" and an agent walks you through real console pages,
  highlighting each button and explaining why. Risky buttons are always your click.
- Build for real, safely: connect your own AWS account with a narrow, read-mostly role; every change
  needs your Approve; everything is small, tagged and easy to clean up.
- Learn: 300 flashcards, architecture puzzles scored on the Well-Architected pillars, quests and
  mini-games.

**Single purpose:** Teaching AWS through a game that reacts to the AWS pages you visit.

**Permission justifications:** see `docs/privacy-policy.md` → Browser permissions.
- `tabs`/`activeTab`: detect which AWS service page is open; screenshot only when the user asks.
- Host `*.console.aws.amazon.com`: the Console Copilot content script (runs only after the user starts it).
- `identity`: Cognito / Google sign-in via `chrome.identity.launchWebAuthFlow`.
- `storage`, `sidePanel`: settings and the side-panel UI.

**Data usage disclosures:** personally identifiable info (email, for sign-in); website content (AWS
Console labels, only while Copilot runs; screenshots only on request). Not sold, not used for
unrelated purposes, not used for creditworthiness.

**Privacy policy URL:** publish `docs/privacy-policy.md` (e.g. GitHub Pages) and paste the URL.

**Assets:** 128×128 icon (`public/icon/128.png`); screenshots 1280×800 from `npm run smoke`
(`.output/smoke/07-city-grown.png`, `17-deploy-preview.png`, `copilot-*.png`, `14-flashcards.png`);
small promo tile 440×280.
