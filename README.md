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
on every message. It prints `STAFF_PASSWORD loaded:` the same way — if that is `false`
the staff screen answers 503 to everyone, which is the safe way to be misconfigured.

## Who can reach what

The café side is public: the site, and `POST /api/chat`, which is how a customer
places an order.

The staff side needs HTTP Basic Auth with the username `staff` and `STAFF_PASSWORD`:
`/staff.html` and its script and stylesheet, `GET /api/orders`, and
`POST /api/orders/:orderId/status`. Basic Auth sends the password on every request,
so serve this over HTTPS anywhere but localhost.

## Limits on /api/chat

A turn can cost up to ten model calls, so the endpoint is capped per IP address:

| Limit | Value | What happens past it |
| --- | --- | --- |
| Requests per minute | 20 | `429` with `Retry-After` |
| Requests per day | 200 | `429` |
| Message length | 1500 characters | `400` |
| History sent to the model | last 10 turns, 8000 characters | older turns dropped |
| Request body | 32kb | `413` |

The history the client sends is trimmed server-side before it reaches the model, so a
long session cannot grow the bill. Deployed behind a proxy, set `TRUST_PROXY` or every
customer shares one rate-limit bucket.

## Tests

```
npm test
```

`test/regression.mjs` drives the ordering tools directly — menu grounding, missing
options, edits, delivery details and the address read-back, pricing, the confirmation
gate and the staff status sequence. It needs no API key, no server and no network, and
it puts `data/orders.json` back as it found it.

## Configuration

| Variable | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required. The assistant cannot answer without it. |
| `STAFF_PASSWORD` | Required to open the staff screen. Username is `staff`. |
| `PORT` | Optional, defaults to 3000. |
| `TRUST_PROXY` | Number of proxies in front of the app, e.g. `1` on Vercel. Leave unset for direct connections. |

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
│                   orders.json   — dev-only storage, gitignored, see below
├── prompts/        system-prompt.md
├── test/           regression.mjs — offline checks over the ordering tools
├── api/            index.js      — serverless entry point, exports the same app
├── vercel.json     routes every path to that function
└── README.md
```

Prices, totals and discounts are worked out on the server from `data/menu.json` and
`data/promotions.json`. The assistant never calculates a price, and a price sent by the
client is ignored.

## Deploying to Vercel

`api/index.js` is the entry point: Vercel treats a default export from `api/` as the
request handler, and an Express app already is one. `vercel.json` rewrites every path
to it, so the platform serves nothing directly — that is deliberate, because the staff
password is enforced by Express middleware and static hosting would serve
`staff.html` around it. `includeFiles` ships `data/`, `prompts/` and `frontend/` into
the function, since those are read from disk at runtime and nothing imports them.

`backend/server.js` only calls `listen` when it is run directly, so `npm start` still
works locally while the platform owns the socket in production.

Set these in **Project → Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your key |
| `STAFF_PASSWORD` | a password that is not the one in your local `.env` |
| `TRUST_PROXY` | `1` — without it every customer shares one rate-limit bucket |

Do not set `PORT`; Vercel assigns it.

**Orders will not survive there, and placing one will fail.** The filesystem is
read-only apart from `/tmp`, so the write in `backend/order-file.js` throws and the
customer gets the fallback apology instead of an order number. The café side — menu,
hours, prices, the whole conversation — works. Taking orders needs real storage
first. See the note at the top of `backend/order-file.js`.

## Before deploying

- **Orders are stored in a file.** Fine locally; on serverless the filesystem is
  read-only and not shared between invocations, so orders cannot be written at all. A
  real database is a V2 upgrade, not a V1 requirement.
- **The staff login is one shared password, over Basic Auth.** There are no accounts,
  no sessions and no lockout, and the password travels on every request — so terminate
  TLS in front of it, and change `STAFF_PASSWORD` when someone leaves.
- **The delivery fee in `data/config.json` is a placeholder** ($3.50), as is the zero tax
  rate — menu prices are tax-inclusive today. Set both to whatever is real.
