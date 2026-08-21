# CLAUDE.md — CafeBot

## Purpose

CafeBot is a café web app: a small site where a customer can browse the menu and
interact with a café assistant bot (ordering help, recommendations, hours, FAQs).
Scope is deliberately small — no accounts, no payments, no admin panel unless asked.

## Architecture

```
frontend/           Static client. Plain HTML/CSS/JS — no framework, no build step.
  index.html        Single page: markup only.
  styles.css        All styling.
  app.js            All client logic; talks to the backend over fetch/JSON.
backend/            Server: serves the API the frontend calls, holds the bot logic
                    and any API keys. Stack not chosen yet — decide before coding.
data/               Menu, hours, and other content as plain files (JSON). No DB yet.
prompts/            Bot prompt templates as separate text/markdown files.
```

Rules that follow from this shape:

- The frontend never calls an LLM or third-party API directly, and never holds a key.
  All of that lives in `backend/`.
- Content (menu items, prices, hours) belongs in `data/`, not hardcoded in markup or JS.
- Prompt text belongs in `prompts/`, not inline in backend source.

## Coding rules

- Keep it minimal. Prefer the plainest thing that works over the general solution.
- No dependencies without asking. No framework, bundler, or CSS library unless requested.
- Vanilla JS, ES modules, no transpiling. Semantic HTML. Mobile-first CSS.
- One concern per file; keep files small enough to read in one pass.
- Match the style already in the file you're editing.
- Don't add abstraction, config options, or error paths for cases that don't exist yet.
- Don't add comments that restate the code.

## Security rules

- Never commit secrets. Keys go in a local `.env` that is gitignored; commit a
  `.env.example` with empty values instead.
- Never expose a key, token, or internal path to the frontend or to bot output.
- Treat all user and bot input as untrusted: validate on the server, escape on render.
  Build DOM with `textContent`, not `innerHTML`, for anything user- or bot-supplied.
- No `eval`, no dynamic code from input, no shell commands built from input.
- Server owns prices and totals. Never trust a price sent by the client.
- Don't put user data in URLs or logs.

## Token-saving rules

- Read only the files the task needs; read the relevant part, not the whole file.
- Search before reading — narrow with grep, then open the hit.
- Edit in place with targeted patches; don't rewrite a whole file for a small change.
- Don't re-read a file you just wrote.
- Don't dump long file contents, diffs, or command output into the reply; summarize.
- Reuse what's already established in the conversation instead of re-deriving it.

## Scope rule

Only modify the files the current task requires. Don't refactor, reformat, rename,
upgrade, or "tidy" anything outside that set. If you spot an unrelated problem,
mention it in one line and leave it alone until asked. When the task is done, stop —
no extra features, no scaffolding for future work.
