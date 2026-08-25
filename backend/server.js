import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import express from 'express';
import basicAuth from 'express-basic-auth';
import rateLimit from 'express-rate-limit';
import { advanceStatus, readOrders } from './order-file.js';
import { getOrder } from './orders.js';
import { runTool, tools } from './tools.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const MAX_TOOL_STEPS = 10;

// A turn can cost up to MAX_TOOL_STEPS model calls, so a request here is not cheap.
// These are the ceilings on what one address can spend.
const CHAT_PER_MINUTE = 20;
const CHAT_PER_DAY = 200;
const MAX_MESSAGE_LENGTH = 1500;
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CHARS = 8000;
const MAX_BODY_SIZE = '32kb';
const FALLBACK_REPLY =
  "Sorry — I'm having trouble thinking right now. Try again in a moment, or ask the team at the counter.";
const TOO_FAST_REPLY =
  "You're sending those faster than I can pour. Give it a minute and try again.";
const TOO_MUCH_REPLY =
  "I've answered as much as I can from here today. The team at the counter can take it from here.";
const TOO_LONG_REPLY = `That message is longer than I can read — keep it under ${MAX_MESSAGE_LENGTH} characters.`;

const read = (...parts) => fs.readFileSync(path.join(rootDir, ...parts), 'utf8');

const systemPrompt = `${read('prompts', 'system-prompt.md')}

## Opening hours data

${read('data', 'hours.json').trim()}
`;

console.log('ANTHROPIC_API_KEY loaded:', Boolean(process.env.ANTHROPIC_API_KEY));
console.log('STAFF_PASSWORD loaded:', Boolean(process.env.STAFF_PASSWORD));

// Orders carry customer names, phone numbers and addresses, so everything that
// reads or changes one sits behind this. With no password set the staff side is
// closed rather than open: an unset variable must never mean "let everyone in".
const staffOnly = process.env.STAFF_PASSWORD
  ? basicAuth({
      users: { staff: process.env.STAFF_PASSWORD },
      challenge: true,
      realm: 'CafeBot staff',
      unauthorizedResponse: { error: 'Staff credentials required.' },
    })
  : (req, res) => {
      res.status(503).json({
        error: 'The staff area is closed: STAFF_PASSWORD is not set on the server.',
      });
    };

// Two ceilings rather than one: the minute limit stops a burst, the daily limit
// stops a slow drip that would still run up a bill overnight.
const limiter = (windowMs, limit, reply) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ reply }),
  });

const chatLimits = [
  limiter(60 * 1000, CHAT_PER_MINUTE, TOO_FAST_REPLY),
  limiter(24 * 60 * 60 * 1000, CHAT_PER_DAY, TOO_MUCH_REPLY),
];

const anthropic = new Anthropic();

const app = express();
const port = process.env.PORT || 3000;

// Behind a proxy every request arrives from the proxy's address, which would put the
// whole cafe in one rate-limit bucket. Set TRUST_PROXY to the number of proxies in
// front of this (Vercel is 1). Left unset for direct connections, because trusting a
// forwarded header nobody set is how an attacker forges an address.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

app.use(express.json({ limit: MAX_BODY_SIZE }));

// Before express.static, or the staff page would be served without ever reaching
// the guard. /api/chat is deliberately not here: that is how customers order.
app.use(['/staff.html', '/staff.js', '/staff.css'], staffOnly);
app.use('/api/orders', staffOnly);

app.use(express.static(path.join(rootDir, 'frontend')));

// The client sends its own history, so none of it can be trusted for size. Keep the
// most recent turns, then drop from the front until they fit a character budget.
function cleanHistory(history) {
  if (!Array.isArray(history)) return [];

  const turns = history
    .filter(
      (turn) =>
        turn &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.content === 'string' &&
        turn.content.trim() !== '',
    )
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_MESSAGE_LENGTH) }))
    .slice(-MAX_HISTORY_TURNS);

  let budget = MAX_HISTORY_CHARS;
  const kept = [];

  for (let i = turns.length - 1; i >= 0; i -= 1) {
    budget -= turns[i].content.length;
    if (budget < 0) break;
    kept.unshift(turns[i]);
  }

  return kept;
}

app.post('/api/chat', chatLimits, async (req, res) => {
  const { message, conversationHistory, sessionId } = req.body ?? {};

  if (typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: 'A message is required.' });
    return;
  }

  // The input has a maxlength attribute; that is a courtesy to the customer, not a
  // limit. This is the limit.
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({
      error: `A message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
      reply: TOO_LONG_REPLY,
    });
    return;
  }

  const order = getOrder(sessionId);

  try {
    const messages = [
      ...cleanHistory(conversationHistory),
      { role: 'user', content: message },
    ];

    let reply = '';

    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools,
        messages,
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      const toolUses = response.content.filter((block) => block.type === 'tool_use');

      // Keep the latest text so a turn that runs out of steps still says something.
      if (text) reply = text;
      if (toolUses.length === 0) break;

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolUses.map((toolUse) => ({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: runTool(toolUse.name, toolUse.input, order),
        })),
      });
    }

    res.json({ reply: reply || FALLBACK_REPLY, sessionId: order.id });
  } catch (error) {
    console.error('Claude request failed:', error);
    res.status(502).json({ reply: FALLBACK_REPLY, sessionId: order.id });
  }
});

app.get('/api/orders', (req, res) => {
  res.json({ orders: readOrders().reverse() });
});

app.post('/api/orders/:orderId/status', (req, res) => {
  const { status } = req.body ?? {};
  const result = advanceStatus(req.params.orderId, status);

  if (result.error) {
    res.status(result.code).json({ error: result.error });
    return;
  }

  res.json({ order: result.order });
});

// express.json rejects an oversized or malformed body by throwing; without this the
// customer would get an HTML error page from a JSON endpoint.
app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: `Request body must be under ${MAX_BODY_SIZE}.` });
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body must be valid JSON.' });
    return;
  }

  next(error);
});

app.listen(port, () => {
  console.log(`CafeBot listening on http://localhost:${port}`);
});
