import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import express from 'express';
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

const anthropic = new Anthropic();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
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
