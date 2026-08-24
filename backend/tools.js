// Tools the chat loop exposes to Claude. Prices and totals are always taken from
// data/menu.json here — never from anything the model or the client sends.

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendOrder, readOrders } from './order-file.js';

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
  {
    name: 'modifyItem',
    description:
      "Changes the quantity, size or options of an item already in the customer's order. Identify the line by its position in the cart, counting from 1. Send only the fields that change - anything you leave out stays as it is. This cannot remove a line or add a new one.",
    input_schema: {
      type: 'object',
      properties: {
        lineNumber: {
          type: 'integer',
          description: 'Which line of the cart to change, counting from 1.',
        },
        quantity: {
          type: 'integer',
          description: 'The new quantity for this line.',
        },
        size: {
          type: 'string',
          description: 'The new size name, for example "Large".',
        },
        options: {
          type: 'object',
          description:
            'Only the options that change, keyed by option name, for example {"Milk": "Soy"}.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['lineNumber'],
    },
  },
  {
    name: 'removeItem',
    description:
      "Removes an item from the customer's order, or reduces how many of it they are having. Identify the line by its position in the cart, counting from 1. Give a quantity to take some off the line; leave quantity out to take the whole line off.",
    input_schema: {
      type: 'object',
      properties: {
        lineNumber: {
          type: 'integer',
          description: 'Which line of the cart to remove from, counting from 1.',
        },
        quantity: {
          type: 'integer',
          description:
            'How many to take off this line. Omit to remove the line entirely. Removing all of them removes the line.',
        },
      },
      required: ['lineNumber'],
    },
  },
  {
    name: 'suggestItems',
    description:
      "Suggests at most two real menu items that go with what the customer has already ordered - something to eat alongside their drink, or a drink alongside their food. Call this when you want to recommend something. It never returns an item that is already in the order or that has been suggested before in this conversation, so a declined suggestion is not repeated. Suggest only what this tool returns, and if it returns nothing, suggest nothing.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pickupDetails',
    description:
      "Reads or records who a pickup order is for and when they want it, collected at the counter. Calling it switches the order to pickup, so use it if a customer changes their mind about delivery. Call with no arguments first to see what is already known and what is still missing - ask the customer only for what the tool reports as missing, never for something it already has. A first name is needed before an order can be finalised; a pickup time is optional and means 'as soon as it is ready' when left out.",
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "The customer's first name, for calling the order out at the counter.",
        },
        pickupTime: {
          type: 'string',
          description:
            'What time they want it, on a 24-hour clock, for example "08:30". Leave out for as soon as possible.',
        },
      },
    },
  },
  {
    name: 'deliveryDetails',
    description:
      "Reads or records where a delivery order is going. Calling it switches the order to delivery. Call with no arguments first to see what is already known and what is still missing - ask the customer only for what the tool reports as missing, and never fill in a name, phone number, address, unit or instruction the customer has not actually given you. Name, phone and address are needed before the order can be finalised. A unit or apartment number is only needed if they live in one, and instructions are optional.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The customer's name." },
        phone: {
          type: 'string',
          description: 'A phone number the driver can reach them on, exactly as the customer gave it.',
        },
        address: {
          type: 'string',
          description: 'The full street address, including number and street name.',
        },
        unit: {
          type: 'string',
          description: 'Apartment, unit or buzzer number, if they have one.',
        },
        instructions: {
          type: 'string',
          description: 'Anything the driver needs to know, such as "side entrance" or "leave with the doorman".',
        },
        confirmAddress: {
          type: 'boolean',
          description:
            'Set this to true only after you have read the addressToReadBack line out to the customer word for word and they have said it is right. Correcting any part of the address clears the confirmation, so read it back and confirm again.',
        },
      },
    },
  },
  {
    name: 'applyPromotion',
    description:
      "Handles discounts. Call with a code when a customer gives you one - if it is not a running promotion the tool says so and you must tell them, never accept a code on the customer's say-so. Call with no arguments to find out which running promotions the current order already qualifies for, so you can mention one. Only promotions this tool returns exist; never offer, invent or honour any other discount.",
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The discount code the customer gave you, exactly as they said it.',
        },
        promotionId: {
          type: 'string',
          description: 'The id of a promotion this tool has already told you about.',
        },
      },
    },
  },
  {
    name: 'getOrderTotal',
    description:
      "Prices the order: every line with its unit price and line total, the subtotal, any discount, tax, delivery fee and the amount to pay. This is the only place prices come from. Call it whenever you need to tell a customer what something costs or read an order back, and quote the numbers it returns exactly. Never add up, estimate, round or work out a price yourself.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'finalizeOrder',
    description:
      "The only way an order is ever placed, and it takes two calls. First call it with nothing: it returns the final summary, which you must read out to the customer in full and then ask whether to place it. When they answer, call it again with confirm true and their reply copied word for word into customerReply. The tool decides whether that reply is a clear yes - a hesitation, a question, a change of mind or anything ambiguous is not a confirmation, and the order stays open. Never tell a customer their order is placed unless this tool says it is.",
    input_schema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'True when you are passing the answer the customer gave to the summary.',
        },
        customerReply: {
          type: 'string',
          description:
            'Exactly what the customer said in reply to the summary, word for word. Never paraphrase it, tidy it up, or supply words they did not say.',
        },
      },
    },
  },
  {
    name: 'viewCart',
    description:
      "Lists what is currently in the customer's order: each line with its position, item, quantity and chosen options. Call this before reading an order back, and whenever you are unsure what has actually been added. It does not return prices or a total.",
    input_schema: { type: 'object', properties: {} },
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

  // The same drink, same options, added again is almost always the model repeating
  // itself rather than the customer asking for a second one. Refuse and point at the
  // line, so a real second one goes through modifyItem as a quantity change.
  const duplicate = order.items.findIndex(
    (line) =>
      line.itemId === item.id &&
      JSON.stringify(line.options) === JSON.stringify(options),
  );

  if (duplicate !== -1) {
    const existing = order.items[duplicate];
    return {
      ok: false,
      error: `${item.name} with those options is already on the order at line ${duplicate + 1}, quantity ${existing.quantity}. Do not add it again. If the customer wants more, change the quantity on that line with modifyItem.`,
      line: { lineNumber: duplicate + 1, name: existing.name, quantity: existing.quantity, options: existing.options },
    };
  }

  // Same item, same choices, plus an option the existing line never had a choice
  // for: the customer is answering a question about the one already on the order,
  // not asking for a second one. Adding it here would charge them twice.
  const refining = order.items.findIndex(
    (line) =>
      line.itemId === item.id &&
      Object.entries(line.options).every(([name, value]) => options[name] === value) &&
      Object.keys(options).length > Object.keys(line.options).length,
  );

  // Apply it to that line rather than refusing: a refusal leaves the choice
  // recorded nowhere while the reply says it was made.
  if (refining !== -1) {
    const existing = order.items[refining];
    existing.options = options;
    recalculate(order);
    order.updatedAt = Date.now();

    return {
      ok: true,
      changed: {
        lineNumber: refining + 1,
        name: existing.name,
        quantity: existing.quantity,
        options: existing.options,
        unitPrice: existing.unitPrice,
        lineTotal: existing.lineTotal,
      },
      note: `${item.name} was already on the order, so this set the choice on line ${refining + 1} instead of adding a second one. Quantity is still ${existing.quantity} - raise it with modifyItem if the customer wants more.`,
      cart: { items: order.items, total: order.total },
    };
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
  recalculate(order);
  order.updatedAt = Date.now();

  return {
    ok: true,
    added: { name: item.name, quantity, options, unitPrice: size.price, lineTotal },
    cart: { items: order.items, total: order.total },
  };
}

function describeCart(order) {
  return order.items.map((line, index) => ({
    lineNumber: index + 1,
    name: line.name,
    quantity: line.quantity,
    options: line.options,
  }));
}

function modifyItem(input, order) {
  const line = order.items[input.lineNumber - 1];
  if (!line) {
    return {
      ok: false,
      error: `There is no line ${input.lineNumber} in the order.`,
      cart: describeCart(order),
    };
  }

  if (input.quantity === undefined && input.size === undefined && input.options === undefined) {
    return { ok: false, error: 'Nothing to change: send a quantity, a size or some options.' };
  }

  const item = getMenu().items.find((candidate) => candidate.id === line.itemId);
  if (!item) {
    return { ok: false, error: `${line.name} is no longer on today's menu, so it cannot be changed.` };
  }

  let quantity = line.quantity;
  if (input.quantity !== undefined) {
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) {
      return { ok: false, error: `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.` };
    }
    quantity = input.quantity;
  }

  let size = item.sizes.find((option) => option.name === line.options.Size) ?? item.sizes[0];
  if (input.size !== undefined) {
    if (item.sizes.length === 1) {
      return { ok: false, error: `${item.name} only comes in one size.` };
    }
    const chosen = matchChoice(input.size, item.sizes.map((option) => option.name));
    if (!chosen) {
      return {
        ok: false,
        error: `"${input.size}" is not a size for ${item.name}.`,
        needs: [{ name: 'Size', choices: item.sizes.map((option) => option.name) }],
      };
    }
    size = item.sizes.find((option) => option.name === chosen);
  }

  const options = { ...line.options };

  for (const [name, value] of Object.entries(input.options ?? {})) {
    const option = item.options.find((candidate) => candidate.name === name);
    if (!option) {
      return {
        ok: false,
        error: `${item.name} has no "${name}" option.`,
        needs: item.options.map((candidate) => ({
          name: candidate.name,
          choices: candidate.choices,
        })),
      };
    }

    const chosen = matchChoice(value, option.choices);
    if (!chosen) {
      return {
        ok: false,
        error: `"${value}" is not a ${option.name} choice for ${item.name}.`,
        needs: [{ name: option.name, choices: option.choices }],
      };
    }

    options[option.name] = chosen;
  }

  if (item.sizes.length > 1) {
    options.Size = size.name;
  }

  line.quantity = quantity;
  line.options = options;
  line.unitPrice = size.price;
  line.lineTotal = money(size.price * quantity);

  recalculate(order);
  order.updatedAt = Date.now();

  return {
    ok: true,
    updated: {
      lineNumber: input.lineNumber,
      name: line.name,
      quantity: line.quantity,
      options: line.options,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    },
    cart: { items: order.items, total: order.total },
  };
}

function removeItem(input, order) {
  const line = order.items[input.lineNumber - 1];
  if (!line) {
    return {
      ok: false,
      error: `There is no line ${input.lineNumber} in the order.`,
      cart: describeCart(order),
    };
  }

  if (input.quantity !== undefined && (!Number.isInteger(input.quantity) || input.quantity < 1)) {
    return { ok: false, error: 'Quantity to remove must be a whole number of 1 or more.' };
  }

  const removing = Math.min(input.quantity ?? line.quantity, line.quantity);
  const removedWholeLine = removing >= line.quantity;

  if (removedWholeLine) {
    order.items.splice(input.lineNumber - 1, 1);
  } else {
    line.quantity -= removing;
    line.lineTotal = money(line.unitPrice * line.quantity);
  }

  recalculate(order);
  order.updatedAt = Date.now();

  return {
    ok: true,
    removed: {
      name: line.name,
      quantity: removing,
      options: line.options,
      lineRemoved: removedWholeLine,
    },
    cart: { items: order.items, total: order.total },
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MAX_NAME_LENGTH = 40;

function readHours() {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'hours.json'), 'utf8'));
}

function normalizeTime(value) {
  const match = /^\s*([0-9]{1,2}):([0-9]{2})\s*$/.exec(String(value));
  if (!match) return null;

  const [, hours, minutes] = match;
  if (Number(hours) > 23 || Number(minutes) > 59) return null;

  return `${hours.padStart(2, '0')}:${minutes}`;
}

function missingPickupDetails(order) {
  return order.customer.name === null ? ['name'] : [];
}

const FIELD_LIMITS = { address: 120, unit: 20, instructions: 200 };

// Nothing here is inferred: a field the customer has not given stays null and
// keeps showing up in `missing`.
function deliveryDetails(input, order) {
  order.delivery ??= { address: null, unit: null, instructions: null };
  order.orderType = 'delivery';

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (name === '' || name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `A name is needed, up to ${MAX_NAME_LENGTH} characters.` };
    }
    order.customer.name = name;
  }

  if (input.phone !== undefined) {
    const phone = String(input.phone).trim();
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length < 7 || digits.length > 15) {
      return { ok: false, error: `"${phone}" does not look like a phone number. Ask the customer to say it again.` };
    }
    order.customer.phone = phone;
  }

  let addressChanged = false;

  for (const field of ['address', 'unit', 'instructions']) {
    if (input[field] === undefined) continue;

    const value = String(input[field]).trim();
    if (value === '' || value.length > FIELD_LIMITS[field]) {
      return {
        ok: false,
        error: `The ${field} must not be empty and must be under ${FIELD_LIMITS[field]} characters.`,
      };
    }

    // Where the order is going has changed, so any earlier read-back is void.
    if (field !== 'instructions' && value !== order.delivery[field]) {
      order.delivery.addressConfirmed = false;
      addressChanged = true;
    }
    order.delivery[field] = value;
  }

  const missing = [];
  if (order.customer.name === null) missing.push('name');
  if (order.customer.phone === null) missing.push('phone');
  if (order.delivery.address === null) missing.push('address');

  let warning;

  if (input.confirmAddress === true) {
    if (order.delivery.address === null) {
      return { ok: false, error: 'There is no address to confirm yet. Ask for it first.' };
    }

    // An address the customer has not heard back cannot have been agreed to, so a
    // call that writes one and confirms it in the same breath confirms nothing.
    if (addressChanged) {
      warning =
        'The address was recorded but not confirmed: it changed in this same call, so the customer cannot have heard it read back yet.';
    } else {
      order.delivery.addressConfirmed = true;
    }
  }

  order.updatedAt = Date.now();

  const addressToReadBack = [order.delivery.address, order.delivery.unit]
    .filter((part) => part !== null)
    .join(', ');

  return {
    ok: true,
    warning,
    orderType: order.orderType,
    name: order.customer.name,
    phone: order.customer.phone,
    address: order.delivery.address,
    unit: order.delivery.unit,
    instructions: order.delivery.instructions,
    missing,
    optional: ['unit', 'instructions'],
    addressToReadBack: addressToReadBack === '' ? null : addressToReadBack,
    addressConfirmed: order.delivery.addressConfirmed,
    readyToFinalise: missing.length === 0 && order.delivery.addressConfirmed,
    nextStep:
      missing.length > 0
        ? `Ask the customer for: ${missing.join(', ')}.`
        : order.delivery.addressConfirmed
          ? 'The address is confirmed. The order can be finalised.'
          : 'Read addressToReadBack out to the customer word for word and ask if it is right. Call this tool again with confirmAddress true if they say yes, or with the corrected address if they do not.',
  };
}

function pickupDetails(input, order) {
  const now = new Date();

  // Mirrors deliveryDetails: asking about pickup is how an order becomes a pickup,
  // including one that was heading out for delivery a moment ago.
  order.orderType = 'pickup';

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (name === '' || name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `A name is needed, up to ${MAX_NAME_LENGTH} characters.` };
    }
    order.customer.name = name;
  }

  if (input.pickupTime !== undefined) {
    const time = normalizeTime(input.pickupTime);
    if (!time) {
      return { ok: false, error: `"${input.pickupTime}" is not a time. Use a 24-hour clock, like "08:30".` };
    }

    const today = readHours().hours.find((day) => day.day === WEEKDAYS[now.getDay()]);
    if (time < today.open || time > today.close) {
      return {
        ok: false,
        error: `The cafe is open ${today.open} to ${today.close} on ${today.day}, so ${time} is not a time we can have it ready.`,
      };
    }

    order.pickupTime = time;
  }

  order.updatedAt = Date.now();

  return {
    ok: true,
    orderType: order.orderType,
    name: order.customer.name,
    pickupTime: order.pickupTime,
    missing: missingPickupDetails(order),
  };
}

function readPromotions() {
  const file = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'promotions.json'), 'utf8'),
  );

  return file.promotions.filter((promotion) => promotion.active);
}

// Which lines a promotion discounts. Empty targets mean the whole order.
function qualifyingLines(promotion, order) {
  const { appliesToItems, appliesToCategories } = promotion.eligibility;
  if (appliesToItems.length === 0 && appliesToCategories.length === 0) return order.items;

  const menu = getMenu().items;

  return order.items.filter((line) => {
    const item = menu.find((candidate) => candidate.id === line.itemId);
    return (
      appliesToItems.includes(line.itemId) ||
      (item !== undefined && appliesToCategories.includes(item.category))
    );
  });
}

function unmetConditions(promotion, order, now) {
  const rules = promotion.eligibility;
  const unmet = [];

  const today = now.toISOString().slice(0, 10);
  if (rules.dateRange.start > today || (rules.dateRange.end && rules.dateRange.end < today)) {
    unmet.push('it is not running today');
  }

  if (!rules.days.includes(WEEKDAYS[now.getDay()])) {
    unmet.push(`it runs on ${rules.days.join(', ')}`);
  }

  const clock = now.toTimeString().slice(0, 5);
  if (clock < rules.timeWindow.start || clock > rules.timeWindow.end) {
    unmet.push(`it runs between ${rules.timeWindow.start} and ${rules.timeWindow.end}`);
  }

  const lines = qualifyingLines(promotion, order);
  if (lines.length === 0) {
    unmet.push('the order has nothing it applies to');
  }

  if (rules.alsoRequiresItemFrom.length > 0) {
    const menu = getMenu().items;
    const present = order.items.some((line) => {
      const item = menu.find((candidate) => candidate.id === line.itemId);
      return item !== undefined && rules.alsoRequiresItemFrom.includes(item.category);
    });
    if (!present) {
      unmet.push(`the order also needs something from ${rules.alsoRequiresItemFrom.join(' or ')}`);
    }
  }

  const subtotal = order.items.reduce((sum, line) => sum + line.lineTotal, 0);
  if (rules.minimumSpend !== null && subtotal < rules.minimumSpend) {
    unmet.push(`it needs a subtotal of at least ${rules.minimumSpend}`);
  }

  return unmet;
}

function discountAmount(promotion, order) {
  const subtotal = qualifyingLines(promotion, order).reduce(
    (sum, line) => sum + line.lineTotal,
    0,
  );

  const raw =
    promotion.discount.type === 'percent_off'
      ? (subtotal * promotion.discount.value) / 100
      : promotion.discount.value;

  return money(Math.min(raw, subtotal));
}

function applyPromotion(input, order) {
  const active = readPromotions();
  const now = new Date();

  let promotion;

  if (input.code !== undefined) {
    promotion = active.find(
      (candidate) =>
        candidate.eligibility.code !== null &&
        candidate.eligibility.code.toLowerCase() === String(input.code).trim().toLowerCase(),
    );
    if (!promotion) {
      return {
        ok: false,
        error: `"${input.code}" is not a promotion the cafe is running. Tell the customer it is not a code you can accept, and that staff at the counter handle promotions.`,
      };
    }
  } else if (input.promotionId !== undefined) {
    promotion = active.find((candidate) => candidate.id === input.promotionId);
    if (!promotion) {
      return { ok: false, error: `There is no running promotion with id "${input.promotionId}".` };
    }
  } else {
    const available = active
      .filter((candidate) => unmetConditions(candidate, order, now).length === 0)
      .map((candidate) => ({
        promotionId: candidate.id,
        name: candidate.name,
        rule: candidate.rule,
        wouldSave: discountAmount(candidate, order),
      }));

    return { ok: true, applied: null, available };
  }

  const unmet = unmetConditions(promotion, order, now);
  if (unmet.length > 0) {
    return {
      ok: false,
      error: `${promotion.name} does not apply to this order: ${unmet.join('; ')}.`,
      promotion: { promotionId: promotion.id, name: promotion.name, rule: promotion.rule },
    };
  }

  order.discount = { id: promotion.id, name: promotion.name, amount: 0 };
  const priced = recalculate(order);
  const amount = order.discount.amount;
  order.updatedAt = Date.now();

  return {
    ok: true,
    applied: { promotionId: promotion.id, name: promotion.name, rule: promotion.rule, amount },
    total: priced.total,
  };
}

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'config.json'), 'utf8'));
}

// The one place an order is priced. Every line is re-priced from the menu, the
// promotion is re-checked against the order as it stands now, and the arithmetic
// happens here - never in the model.
export function recalculate(order) {
  const menu = getMenu().items;

  for (const line of order.items) {
    const item = menu.find((candidate) => candidate.id === line.itemId);
    if (!item) continue;

    const size = item.sizes.find((option) => option.name === line.options.Size) ?? item.sizes[0];
    line.unitPrice = size.price;
    line.lineTotal = money(size.price * line.quantity);
  }

  const subtotal = money(order.items.reduce((sum, line) => sum + line.lineTotal, 0));

  const promotion = order.discount.id
    ? readPromotions().find((candidate) => candidate.id === order.discount.id)
    : undefined;

  if (promotion && unmetConditions(promotion, order, new Date()).length === 0) {
    order.discount = {
      id: promotion.id,
      name: promotion.name,
      amount: discountAmount(promotion, order),
    };
  } else {
    order.discount = { id: null, name: null, amount: 0 };
  }

  const config = readConfig();
  const discounted = money(subtotal - order.discount.amount);
  const tax = money(discounted * config.taxRate);
  const deliveryFee =
    order.orderType === 'delivery' && order.items.length > 0 ? config.deliveryFee : 0;

  order.total = money(discounted + tax + deliveryFee);

  return {
    currency: config.currency,
    lines: order.items.map((line, index) => ({
      lineNumber: index + 1,
      name: line.name,
      quantity: line.quantity,
      options: line.options,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
    subtotal,
    discount: order.discount,
    tax,
    taxRate: config.taxRate,
    deliveryFee,
    total: order.total,
  };
}

const DRINK_CATEGORIES = ['Coffee', 'Tea & Cold Drinks'];

// Pair a drinks-only order with something to eat, and a food-only order with a
// drink. An order that already has both needs nothing suggested.
function suggestItems(order) {
  order.suggested ??= [];

  const inCart = order.items.map((line) => line.itemId);
  const categories = new Set(
    order.items.map(
      (line) => getMenu().items.find((item) => item.id === line.itemId)?.category,
    ),
  );

  const hasDrink = DRINK_CATEGORIES.some((category) => categories.has(category));
  const hasFood = categories.has('Bakery');

  let wanted = [];
  if (hasDrink && !hasFood) wanted = ['Bakery'];
  else if (hasFood && !hasDrink) wanted = DRINK_CATEGORIES;

  const suggestions = getMenu()
    .items.filter(
      (item) =>
        wanted.includes(item.category) &&
        !inCart.includes(item.id) &&
        !order.suggested.includes(item.id),
    )
    .slice(0, 2)
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      price: item.price,
      description: item.description,
    }));

  order.suggested.push(...suggestions.map((item) => item.itemId));

  return { ok: true, suggestions };
}

function viewCart(order) {
  return {
    ok: true,
    empty: order.items.length === 0,
    items: describeCart(order),
  };
}

// A clear yes and nothing else. Anything hedged, questioning or conditional is not
// a confirmation, however agreeable it sounds.
const AFFIRMATIVE = new Set([
  'yes', 'yeah', 'yep', 'yup', 'ya', 'sure', 'ok', 'okay', 'correct', 'confirm',
  'confirmed', 'absolutely', 'definitely', 'right', 'perfect', 'great',
]);

// Words that keep a reply a plain yes rather than turning it into a new request.
const FILLER = new Set([
  'please', 'do', 'it', 'in', 'put', 'that', 'thats', 'this', 'is', 'go', 'ahead',
  'sounds', 'good', 'thanks', 'thank', 'you', 'the', 'order', 'place', 'lets', 'let',
  'us', 'all', 'set', 'now', 'fine', 'works', 'for', 'me', 'and', 'sir', 'mate',
]);

const HESITATION =
  /\b(but|although|though|however|wait|hold|actually|instead|change|swap|remove|add|another|also|extra|maybe|perhaps|probably|might|unsure|dunno|guess|think|almost|nearly|except|first|before|can|could|would|what|how|when|where|why|no|nope|not|dont|cancel|hmm|um|er)\b/;

const AFFIRMATIVE_PHRASES = new Set([
  'go ahead', 'go for it', 'sounds good', 'looks good', 'all good', 'thats right',
  'that is right', 'thats correct', 'that is correct', 'thats it', 'place it',
  'put it in', 'do it',
]);

// A reply counts only when every word in it is a yes or harmless padding. Anything
// that hedges, questions, or introduces a new request is not a confirmation.
function isExplicitYes(reply) {
  const text = String(reply)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z\s?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text === '' || String(reply).includes('?')) return false;
  if (HESITATION.test(text)) return false;
  if (AFFIRMATIVE_PHRASES.has(text)) return true;

  const words = text.split(' ');

  return (
    words.some((word) => AFFIRMATIVE.has(word)) &&
    words.every((word) => AFFIRMATIVE.has(word) || FILLER.has(word))
  );
}

function summaryOf(order) {
  const priced = recalculate(order);

  const fulfilment =
    order.orderType === 'delivery'
      ? {
          type: 'delivery',
          name: order.customer.name,
          phone: order.customer.phone,
          address: [order.delivery.address, order.delivery.unit]
            .filter((part) => part !== null && part !== undefined)
            .join(', '),
          instructions: order.delivery.instructions,
        }
      : {
          type: 'pickup',
          name: order.customer.name,
          pickupTime: order.pickupTime,
          where: 'the counter at 214 Maple Street',
        };

  return { fulfilment, ...priced };
}

function blockers(order) {
  const missing = [];

  if (order.items.length === 0) missing.push('the order is empty');
  if (order.customer.name === null) missing.push('no name');

  if (order.orderType === 'delivery') {
    if (order.customer.phone === null) missing.push('no phone number');
    if (order.delivery.address === null) missing.push('no address');
    else if (!order.delivery.addressConfirmed) missing.push('the address has not been read back and confirmed');
  }

  return missing;
}

function newOrderId(now, taken) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');

  let id;
  do {
    id = `CB-${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
  } while (taken.has(id));

  return id;
}

// Only ever called once an order has passed every confirmation check. Nothing
// writes a draft here.
function saveOrder(order) {
  const file = path.join(rootDir, 'data', 'orders.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = new Date();

  const record = {
    orderId: newOrderId(now, new Set(saved.map((entry) => entry.orderId))),
    status: 'NEW',
    placedAt: now.toISOString(),
    orderType: order.orderType,
    customer: order.customer,
    pickupTime: order.pickupTime,
    delivery: order.orderType === 'delivery' ? order.delivery : null,
    items: order.items,
    discount: order.discount,
    total: order.total,
    sessionId: order.id,
  };

  appendOrder(record);

  return record.orderId;
}

function finalizeOrder(input, order) {
  if (order.status === 'confirmed') {
    return {
      ok: false,
      orderId: order.orderId,
      error: 'This order has already been placed. Staff at the counter handle changes to a placed order.',
    };
  }

  const unmet = blockers(order);
  if (unmet.length > 0) {
    return { ok: false, error: `The order cannot be placed yet: ${unmet.join('; ')}.`, blockers: unmet };
  }

  const summary = summaryOf(order);
  const fingerprint = createHash('sha256').update(JSON.stringify(summary)).digest('hex');

  const answering = input.confirm === true || typeof input.customerReply === 'string';

  if (!answering) {
    order.summaryShown = fingerprint;
    order.updatedAt = Date.now();

    return {
      ok: true,
      placed: false,
      summary,
      nextStep:
        'Read this summary out to the customer in full, then ask whether to place the order. When they answer, call this tool again passing their exact words in customerReply. Do not call it with no arguments a second time - that just re-asks the same question.',
    };
  }

  if (order.summaryShown === null) {
    order.summaryShown = fingerprint;

    return {
      ok: false,
      placed: false,
      summary,
      error:
        'The customer has not been read this summary yet, so that reply does not count as confirmation. Read it out in full, ask again, and pass their next reply.',
    };
  }

  if (order.summaryShown !== fingerprint) {
    order.summaryShown = fingerprint;
    return {
      ok: false,
      placed: false,
      summary,
      error:
        'The order changed after the summary was read out, so that confirmation does not stand. Read this new summary out and ask again.',
    };
  }

  if (!isExplicitYes(input.customerReply)) {
    return {
      ok: false,
      placed: false,
      error:
        'That is not a clear yes, so the order has not been placed. Ask the customer plainly whether to place it, or deal with what they raised first.',
    };
  }

  order.confirmed = true;
  order.status = 'confirmed';
  order.updatedAt = Date.now();
  order.orderId = saveOrder(order);

  return { ok: true, placed: true, orderId: order.orderId, status: 'NEW', summary };
}

const LOCKED_AFTER_CONFIRMATION = [
  'addItemToCart',
  'modifyItem',
  'removeItem',
  'applyPromotion',
  'pickupDetails',
  'deliveryDetails',
];

export function runTool(name, input, order) {
  if (order.status === 'confirmed' && LOCKED_AFTER_CONFIRMATION.includes(name)) {
    return JSON.stringify({
      ok: false,
      error: 'This order has already been placed and cannot be changed. Point the customer to staff at the counter.',
    });
  }

  if (name === 'getMenu') return JSON.stringify(getMenu());
  if (name === 'addItemToCart') return JSON.stringify(addItemToCart(input ?? {}, order));
  if (name === 'modifyItem') return JSON.stringify(modifyItem(input ?? {}, order));
  if (name === 'removeItem') return JSON.stringify(removeItem(input ?? {}, order));
  if (name === 'viewCart') return JSON.stringify(viewCart(order));
  if (name === 'finalizeOrder') return JSON.stringify(finalizeOrder(input ?? {}, order));
  if (name === 'getOrderTotal') return JSON.stringify({ ok: true, ...recalculate(order) });
  if (name === 'suggestItems') return JSON.stringify(suggestItems(order));
  if (name === 'applyPromotion') return JSON.stringify(applyPromotion(input ?? {}, order));
  if (name === 'pickupDetails') return JSON.stringify(pickupDetails(input ?? {}, order));
  if (name === 'deliveryDetails') return JSON.stringify(deliveryDetails(input ?? {}, order));

  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}
