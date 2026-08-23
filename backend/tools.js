// Tools the chat loop exposes to Claude. Prices and totals are always taken from
// data/menu.json here — never from anything the model or the client sends.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAX_QUANTITY = 20;

export const tools = [
  {
    name: 'getMenu',
    description:
      'Returns everything the cafe is selling today: name, description, price, sizes, options and allergens for each available item. Call this before answering any question about what the cafe sells or what something costs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'addItemToCart',
    description:
      "Adds one menu item to the customer's order. Call this only once the customer has chosen every required option. If anything required is missing the item is not added and the tool tells you what to ask for - ask the customer, never guess a size or a milk for them.",
    input_schema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'The item id from getMenu, for example "flat-white".',
        },
        quantity: {
          type: 'integer',
          description: 'How many of this item. Defaults to 1.',
        },
        size: {
          type: 'string',
          description: 'One of the size names from getMenu, for example "Large".',
        },
        options: {
          type: 'object',
          description:
            'The customer\'s choices keyed by option name, for example {"Milk": "Oat", "Temperature": "Iced"}.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['itemId'],
    },
  },
];

function readMenu() {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'menu.json'), 'utf8'));
}

function getMenu() {
  const menu = readMenu();

  return {
    currency: menu.currency,
    note: menu.note,
    items: menu.items.filter((item) => item.available),
  };
}

const money = (amount) => Math.round(amount * 100) / 100;

function matchChoice(value, choices) {
  if (typeof value !== 'string') return null;
  return choices.find((choice) => choice.toLowerCase() === value.trim().toLowerCase()) ?? null;
}

function addItemToCart(input, order) {
  const item = getMenu().items.find((candidate) => candidate.id === input.itemId);
  if (!item) {
    return {
      ok: false,
      error: `No item with id "${input.itemId}" is on the menu today. Call getMenu and use one of the ids it returns.`,
    };
  }

  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return { ok: false, error: `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.` };
  }

  const needs = [];

  let size = item.sizes[0];
  if (item.sizes.length > 1) {
    const chosen = matchChoice(input.size, item.sizes.map((option) => option.name));
    if (input.size !== undefined && !chosen) {
      return {
        ok: false,
        error: `"${input.size}" is not a size for ${item.name}.`,
        needs: [{ name: 'Size', choices: item.sizes.map((option) => option.name) }],
      };
    }
    if (!chosen) {
      needs.push({ name: 'Size', choices: item.sizes.map((option) => option.name) });
    }
    size = item.sizes.find((option) => option.name === chosen) ?? size;
  }

  const supplied = input.options ?? {};
  const options = {};

  for (const option of item.options) {
    const chosen = matchChoice(supplied[option.name], option.choices);

    if (supplied[option.name] !== undefined && !chosen) {
      return {
        ok: false,
        error: `"${supplied[option.name]}" is not a ${option.name} choice for ${item.name}.`,
        needs: [{ name: option.name, choices: option.choices }],
      };
    }

    if (chosen) {
      options[option.name] = chosen;
    } else if (option.required) {
      needs.push({ name: option.name, choices: option.choices });
    }
  }

  if (needs.length > 0) {
    return {
      ok: false,
      error: `${item.name} was not added.`,
      needs,
      askCustomer: true,
    };
  }

  if (item.sizes.length > 1) {
    options.Size = size.name;
  }

  const lineTotal = money(size.price * quantity);

  order.items.push({
    itemId: item.id,
    name: item.name,
    quantity,
    options,
    unitPrice: size.price,
    lineTotal,
  });
  order.total = money(
    order.items.reduce((sum, line) => sum + line.lineTotal, 0) - order.discount.amount,
  );
  order.updatedAt = Date.now();

  return {
    ok: true,
    added: { name: item.name, quantity, options, unitPrice: size.price, lineTotal },
    cart: { items: order.items, total: order.total },
  };
}

export function runTool(name, input, order) {
  if (name === 'getMenu') return JSON.stringify(getMenu());
  if (name === 'addItemToCart') return JSON.stringify(addItemToCart(input ?? {}, order));

  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}
