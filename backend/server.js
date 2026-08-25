import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import express from 'express';
import basicAuth from 'express-basic-auth';
import { advanceStatus, readOrders } from './order-file.js';
import { getOrder } from './orders.js';
import { runTool, tools } from './tools.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const MAX_TOOL_STEPS = 10;
const FALLBACK_REPLY =
  "Sorry — I'm having trouble thinking right now. Try again in a moment, or ask the team at the counter.";

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

const anthropic = new Anthropic();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Before express.static, or the staff page would be served without ever reaching
// the guard. /api/chat is deliberately not here: that is how customers order.
app.use(['/staff.html', '/staff.js', '/staff.css'], staffOnly);
app.use('/api/orders', staffOnly);

app.use(express.static(path.join(rootDir, 'frontend')));

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      (turn) =>
        turn &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.content === 'string' &&
        turn.content.trim() !== '',
    )
    .map((turn) => ({ role: turn.role, content: turn.content }));
}

app.post('/api/chat', async (req, res) => {
  const { message, conversationHistory, sessionId } = req.body ?? {};

  if (typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: 'A message is required.' });
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

app.listen(port, () => {
  console.log(`CafeBot listening on http://localhost:${port}`);
});
