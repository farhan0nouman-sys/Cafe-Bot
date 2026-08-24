# CafeBot

A café web app: a customer browses the menu and orders through a chat assistant, and
staff work the orders on a separate screen. Static frontend, Express backend, Claude
for the assistant. No build step, no database.

## Running it

Node 18 or newer (developed on 24).

```
npm install
cp .env.example .env      # then put your Anthropic API key in it
npm start
```

Then open http://localhost:3000 for the café, and http://localhost:3000/staff.html for
the orders screen.

`npm start` prints `ANTHROPIC_API_KEY loaded: true` if the key was picked up. If it says
`false`, the key is missing from `.env` and the assistant will fall back to an apology
on every message.

## Configuration

| Variable | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required. The assistant cannot answer without it. |
| `PORT` | Optional, defaults to 3000. |

`.env` is gitignored and must stay that way — the key belongs there and nowhere else.
`.env.example` is committed with empty values as the template.

## Structure

```
CafeBot/
├── frontend/       index.html, styles.css, app.js  — the café and the chat widget
│                   staff.html, staff.css, staff.js — the orders screen
├── backend/        server.js     — Express, static files, /api routes, the Claude loop
│                   tools.js      — the tools the assistant may call, and all pricing
│                   orders.js     — in-memory order state, keyed by session
│                   order-file.js — reads and writes data/orders.json
├── data/           menu.json, hours.json, promotions.json, config.json
│                   orders.json   — dev-only storage, see below
├── prompts/        system-prompt.md
└── README.md
```

Prices, totals and discounts are worked out on the server from `data/menu.json` and
`data/promotions.json`. The assistant never calculates a price, and a price sent by the
client is ignored.

## Before deploying

- **Orders are stored in a file.** `data/orders.json` is fine for local development and
  demos. On serverless hosting such as Vercel the filesystem is ephemeral and not shared
  between invocations, so orders written there can vanish. A real database is a V2
  upgrade, not a V1 requirement — see the note at the top of `backend/order-file.js`.
- **The staff screen has no authentication.** `/staff.html`, `GET /api/orders` and
  `POST /api/orders/:id/status` are open to anyone who can reach the server, and orders
  hold customer names, phone numbers and addresses.
- **`data/orders.json` is tracked in git.** It is committed empty; keep it that way, or
  untrack it before real orders go through:
  `git rm --cached data/orders.json && echo "data/orders.json" >> .gitignore`
- **The delivery fee in `data/config.json` is a placeholder** ($3.50), as is the zero tax
  rate — menu prices are tax-inclusive today. Set both to whatever is real.
