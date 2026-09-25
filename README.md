# 🏙️ AWS City

Habbo Hotel for learning AWS: a Chrome extension with a living isometric pixel city. You are
**Kai** (yellow jacket). Every AWS service is a themed place run by an agent who does that service's job:
- Sally fishes objects out of **S3 Lake**.
- Sir Shieldon blocks DDoS arrows at the **Shield Wall**.
- Ruby pairs DNS dancers at the **Route 53 Dance Hall**.
- Lola cooks only when an order arrives at the **Lambda Food Stall**.

- **Browse AWS and the city grows.** Open a console or docs page and its landmark gets discovered.
  Learning upgrades it from Foundation to Expert (tiers mapped to the AWS certification ladder).
- **Agents visibly work when real AWS calls run.** When idle they walk around; when working they
  fish, guard, cook, or sit and type in their district HQ. When they talk, packets travel the roads.
- **Type what you want to do or learn.** The Concierge dispatches an agent. It walks over and shows
  every step, calling in other agents when needed, and it remembers what you already know.
- **Learn and play:**
  - 288 fact-checked flashcards with spaced repetition and a docs source on every card.
  - An architecture builder scored on the 6 Well-Architected pillars.
  - 8 quest lines.
  - 4 mini-games: S3 fishing, Shield Wall, Route 53 Dance Hall, Lambda Food Stall.
- **Build for real.** The Deploy tab lets agents make real changes in AWS. **Nothing changes until
  you approve the preview.**
- **A living city:** 6 districts × 6 services, citizens walking and chatting, day and night, and
  chiptune (muted by default).

## Run it

```bash
npm install
npm run open         # builds and opens a Chromium window with AWS City loaded (branded Chrome ignores --load-extension)
```

Or build and load it yourself: run `npm run build`, open `chrome://extensions`, choose
**Load unpacked**, and pick `.output/chrome-mv3`. The toolbar icon opens the **side panel**, and ⤢
opens the **full city** tab. Move Kai by clicking, or with **WASD/arrow keys**; press **E** to talk
or enter.

```bash
npm run check        # tsc + unit tests (contract, content completeness, SRS, puzzle scoring, routing)
npm run smoke        # build + Playwright run through every mode; screenshots → .output/smoke
npm run art          # regenerate pixel art (characters + city) from art/
npm run assets       # re-fetch Kenney CC0 fonts & sounds (scripts/assets.txt)
```

## Backends

The contract is **[docs/backend-contract.md](docs/backend-contract.md)**; its source of truth is
`src/backend/contract.ts`.

| `.env.local` | What runs |
|---|---|
| `WXT_BACKEND=mock` (default) | Scripted agents in the browser. No AWS needed; good for demos. |
| `WXT_BACKEND=aws` | **`server/`**: the team's local Node server. It uses a real workshop AWS account and Claude on Bedrock. |
| `WXT_BACKEND=agentcore` | A Strands swarm on Bedrock AgentCore Runtime (branch `parked/agentcore-backend`). It needs an account that allows IAM roles. |

```bash
cd server && npm install && EXTENSION_ORIGIN=chrome-extension://<id> npm start   # prints the .env.local values
```

The workshop account blocks CloudFormation and IAM roles, which is why the server runs locally. See
[`server/README.md`](server/README.md) for its guardrails and approvals.

## Where things live

```
shared/           world.json (36 services), flashcards, puzzles, quests, templates   ← content
art/              characters/ (team generator + AWS looks), tiles/ (city generator)   ← pixel art source
src/world/        typed accessors over shared/, city layout
src/backend/      contract.ts, MockBackend, ServerBackend (server/), AgentCoreBackend  ← only I/O here
src/learning/     spaced repetition, Well-Architected scoring
src/game/         Phaser 4 (pixelArt): city, HQ rooms, mini-games, citizens, day/night, audio
src/ui/           React panels: feed, quests, cards, builder, deploy, map, place, chat
server/           the team's local AWS backend (Node + Bedrock), with player approvals
```

## Credits

Characters come from the team's Habbo-style pixel generator (`art/characters`). The city art is
generated in the same style (`art/tiles`). Fonts and sounds are from [Kenney](https://kenney.nl), CC0.
