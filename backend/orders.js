// Order state for one chat session. In memory only — everything is lost on
// restart, and it is not shared between processes. No database yet.

import { randomUUID } from 'node:crypto';

const SESSION_TTL = 2 * 60 * 60 * 1000;

const sessions = new Map();

function newOrder() {
  return {
    id: randomUUID(),
    // { itemId, name, quantity, options: { Size: 'Large', Milk: 'Oat' },
    //   unitPrice, lineTotal }
    items: [],
    orderType: 'pickup',
    customer: { name: null, phone: null },
    discount: { id: null, name: null, amount: 0 },
    total: 0,
    confirmed: false,
    status: 'open',
    updatedAt: Date.now(),
  };
}

function prune(now) {
  for (const [id, order] of sessions) {
    if (now - order.updatedAt > SESSION_TTL) sessions.delete(id);
  }
}

export function getOrder(sessionId) {
  const now = Date.now();
  prune(now);

  const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
  if (existing) {
    existing.updatedAt = now;
    return existing;
  }

  const order = newOrder();
  sessions.set(order.id, order);
  return order;
}
