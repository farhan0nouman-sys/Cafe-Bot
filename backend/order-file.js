// Reads and writes data/orders.json. Dev-only storage: a whole-file rewrite per
// change, which is fine for one café on one machine and nothing more.
//
// This is for development and demos, not production. On Vercel's serverless
// functions the filesystem is ephemeral and not shared between invocations: a
// write may vanish when the instance is recycled, and two instances running at
// once will not see each other's orders. Deployed there, orders placed through
// this module would be lost.
//
// The fix is a real database, and that is a V2 upgrade rather than a V1
// requirement. Everything above the storage layer stays as it is - swapping
// readOrders, appendOrder and advanceStatus for database calls is the whole job.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'orders.json',
);

export const STATUSES = ['NEW', 'PREPARING', 'READY', 'COMPLETED'];

export function readOrders() {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeOrders(orders) {
  fs.writeFileSync(file, `${JSON.stringify(orders, null, 2)}\n`);
}

export function appendOrder(record) {
  const orders = readOrders();
  orders.push(record);
  writeOrders(orders);
}

export function advanceStatus(orderId, status) {
  const orders = readOrders();
  const order = orders.find((candidate) => candidate.orderId === orderId);

  if (!order) return { error: 'No order with that id.', code: 404 };

  const next = STATUSES[STATUSES.indexOf(order.status) + 1];
  if (status !== next) {
    return {
      error: `${order.status} can only move to ${next ?? 'nothing — it is already complete'}.`,
      code: 400,
    };
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();
  writeOrders(orders);

  return { order };
}
