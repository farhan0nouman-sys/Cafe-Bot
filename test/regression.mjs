// Regression pass over the ordering tools. Run with `npm test`.
//
// Everything here is deterministic and offline - no API key, no server, no
// network. It drives runTool directly, the way the chat loop does.
//
// Placing an order writes to data/orders.json, so the file is snapshotted before
// the run and put back afterwards, whether the run passes, fails or throws.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { advanceStatus, readOrders } from '../backend/order-file.js';
import { getOrder } from '../backend/orders.js';
import { runTool } from '../backend/tools.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ordersFile = path.join(rootDir, 'data', 'orders.json');
// Gitignored, so a fresh clone has no file. Null means "there was none": the run
// puts that back too, rather than leaving one behind.
const ordersBefore = fs.existsSync(ordersFile) ? fs.readFileSync(ordersFile, 'utf8') : null;

let pass = 0;
const fails = [];

const fresh = () => getOrder(undefined);
const call = (order, name, input) => JSON.parse(runTool(name, input ?? {}, order));
const section = (title) => console.log('\n== ' + title + ' ==');

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    return;
  }

  fails.push(name);
  console.log('  FAIL ' + name + (detail === undefined ? '' : '\n        ' + JSON.stringify(detail)));
}

try {
  section('1. MENU ACCURACY');
  {
    const o = fresh();
    const menu = call(o, 'getMenu');
    check('getMenu returns 11 available items', menu.items.length === 11, menu.items.length);
    check('prices are numbers on every size', menu.items.every((i) => i.sizes.every((s) => typeof s.price === 'number')));
    check('invented item refused', call(o, 'addItemToCart', { itemId: 'pumpkin-spice-latte' }).ok === false);
    check('invented size refused', call(o, 'addItemToCart', { itemId: 'flat-white', size: 'Venti', options: { Milk: 'Oat' } }).ok === false);
    check('invented milk refused', call(o, 'addItemToCart', { itemId: 'flat-white', size: 'Regular', options: { Milk: 'Coconut' } }).ok === false);

    const suggested = call(o, 'suggestItems');
    const ids = menu.items.map((i) => i.id);
    check('suggestions capped at two and all real', suggested.suggestions.length <= 2 && suggested.suggestions.every((s) => ids.includes(s.itemId)), suggested);
    const again = call(o, 'suggestItems');
    check('a declined suggestion is not repeated', again.suggestions.every((s) => !suggested.suggestions.some((p) => p.itemId === s.itemId)), again);
  }

  section('2. MISSING-OPTION HANDLING');
  {
    const o = fresh();
    const bare = call(o, 'addItemToCart', { itemId: 'mocha' });
    check('mocha asks for size, temperature and milk', bare.ok === false && bare.askCustomer === true && bare.needs.length === 3, bare);
    check('nothing added while options are missing', o.items.length === 0);

    const partial = call(o, 'addItemToCart', { itemId: 'mocha', size: 'Large', options: { Temperature: 'Iced' } });
    check('asks only for what is still missing', partial.ok === false && partial.needs.length === 1 && partial.needs[0].name === 'Milk', partial);
    check('single-size no-option item adds straight', call(o, 'addItemToCart', { itemId: 'espresso' }).ok === true);
    check('optional Warmed does not block', call(o, 'addItemToCart', { itemId: 'butter-croissant' }).ok === true);
    check('option matching is case-insensitive', call(o, 'addItemToCart', { itemId: 'flat-white', size: 'regular', options: { Milk: 'oat' } }).ok === true);
  }

  section('3. ITEM MODIFICATION');
  {
    const o = fresh();
    call(o, 'addItemToCart', { itemId: 'flat-white', size: 'Regular', options: { Milk: 'Oat' } });
    check('quantity change reprices', call(o, 'modifyItem', { lineNumber: 1, quantity: 3 }).updated.lineTotal === 12.75);

    const resized = call(o, 'modifyItem', { lineNumber: 1, size: 'Large' });
    check('size change reprices', resized.updated.unitPrice === 4.95 && resized.updated.lineTotal === 14.85, resized);

    const remilked = call(o, 'modifyItem', { lineNumber: 1, options: { Milk: 'Soy' } });
    check('option change keeps the size', remilked.updated.options.Size === 'Large' && remilked.updated.options.Milk === 'Soy', remilked);
    check('unknown line refused', call(o, 'modifyItem', { lineNumber: 9 }).ok === false);
    check('invalid size refused', call(o, 'modifyItem', { lineNumber: 1, size: 'Grande' }).ok === false);
    check('unknown option refused', call(o, 'modifyItem', { lineNumber: 1, options: { Syrup: 'Vanilla' } }).ok === false);
    check('empty modify refused', call(o, 'modifyItem', { lineNumber: 1 }).ok === false);

    call(o, 'removeItem', { lineNumber: 1, quantity: 1 });
    check('partial remove leaves two', o.items[0].quantity === 2);
    call(o, 'removeItem', { lineNumber: 1 });
    check('full remove empties the cart', o.items.length === 0);
    check('viewCart reports empty', call(o, 'viewCart').empty === true);
  }

  section('4. DELIVERY DETAILS');
  {
    const o = fresh();
    const bare = call(o, 'deliveryDetails');
    check('bare call switches to delivery and lists everything missing', bare.orderType === 'delivery' && bare.missing.join() === 'name,phone,address', bare);
    check('nothing is invented', bare.name === null && bare.phone === null && bare.address === null, bare);
    check('bad phone refused', call(o, 'deliveryDetails', { phone: '12' }).ok === false);

    const given = call(o, 'deliveryDetails', { name: 'Sam', phone: '555-0142', address: '18 Larch Road' });
    check('recorded exactly as given', given.name === 'Sam' && given.phone === '555-0142' && given.address === '18 Larch Road', given);
    check('unit and instructions stay optional', given.missing.length === 0 && given.unit === null && given.optional.join() === 'unit,instructions', given);
    check('not ready before the read-back', given.readyToFinalise === false, given);
  }

  section('5. ADDRESS CONFIRMATION');
  {
    const o = fresh();
    call(o, 'deliveryDetails', { name: 'Sam', phone: '555-0142', address: '18 Larch Road', unit: 'Apt 4B' });
    check('read-back line includes the unit', call(o, 'deliveryDetails').addressToReadBack === '18 Larch Road, Apt 4B');
    check('confirming makes it ready', call(o, 'deliveryDetails', { confirmAddress: true }).readyToFinalise === true);
    check('changing the address clears confirmation', call(o, 'deliveryDetails', { address: '19 Larch Road' }).addressConfirmed === false);

    call(o, 'deliveryDetails', { confirmAddress: true });
    check('changing the unit clears confirmation', call(o, 'deliveryDetails', { unit: 'Apt 5B' }).addressConfirmed === false);

    call(o, 'deliveryDetails', { confirmAddress: true });
    check('instructions do not clear confirmation', call(o, 'deliveryDetails', { instructions: 'side door' }).addressConfirmed === true);

    // An address the customer has not heard read back cannot have been agreed to.
    const batched = fresh();
    const oneShot = call(batched, 'deliveryDetails', { name: 'Ada', phone: '5550199', address: '3 Kiln Lane', confirmAddress: true });
    check('address cannot be written and confirmed in one call', oneShot.addressConfirmed === false && typeof oneShot.warning === 'string', oneShot);
    check('it can be confirmed on the next call', call(batched, 'deliveryDetails', { confirmAddress: true }).readyToFinalise === true);
    check('confirming with no address at all is refused', call(fresh(), 'deliveryDetails', { confirmAddress: true }).ok === false);
  }

  section('6. DETERMINISTIC TOTALS');
  {
    const o = fresh();
    call(o, 'addItemToCart', { itemId: 'flat-white', size: 'Large', options: { Milk: 'Oat' }, quantity: 2 });
    call(o, 'addItemToCart', { itemId: 'almond-biscotti', quantity: 3 });

    const priced = call(o, 'getOrderTotal');
    check('subtotal 2x4.95 + 3x2.50 = 17.40', priced.subtotal === 17.4, priced);
    check('tax zero per config', priced.tax === 0 && priced.taxRate === 0, priced);
    check('no delivery fee on a pickup order', priced.deliveryFee === 0, priced);

    call(o, 'deliveryDetails', { name: 'Sam' });
    const delivered = call(o, 'getOrderTotal');
    check('delivery adds 3.50 -> 20.90', delivered.deliveryFee === 3.5 && delivered.total === 20.9, delivered);
    check('repeat call is identical', JSON.stringify(delivered) === JSON.stringify(call(o, 'getOrderTotal')));
    check('inactive code refused', call(o, 'applyPromotion', { code: 'SUMMERBREW' }).ok === false);
    check('made-up code refused', call(o, 'applyPromotion', { code: 'FREECOFFEE' }).ok === false);
    check('made-up promotion id refused', call(o, 'applyPromotion', { promotionId: 'staff-discount' }).ok === false);

    const empty = fresh();
    call(empty, 'deliveryDetails', { name: 'Sam' });
    check('empty delivery order has no fee', call(empty, 'getOrderTotal').total === 0);
  }

  section('6b. PROMOTION MATH (faked clock)');
  {
    const RealDate = Date;
    const fakeClock = (iso) => {
      global.Date = class extends RealDate {
        constructor(...args) {
          super();
          return args.length ? new RealDate(...args) : new RealDate(iso);
        }

        static now() {
          return new RealDate(iso).getTime();
        }
      };
    };
    const realClock = () => {
      global.Date = RealDate;
    };

    fakeClock('2026-08-24T08:00:00');
    const morning = fresh();
    call(morning, 'addItemToCart', { itemId: 'flat-white', size: 'Regular', options: { Milk: 'Whole' } });
    call(morning, 'addItemToCart', { itemId: 'cardamom-bun' });
    check('early bird offered inside its window', call(morning, 'applyPromotion', {}).available.some((p) => p.promotionId === 'early-bird-pairing'));
    check('early bird takes off 1.00', call(morning, 'applyPromotion', { promotionId: 'early-bird-pairing' }).applied.amount === 1);
    check('total 4.25 + 4.25 - 1 = 7.50', call(morning, 'getOrderTotal').total === 7.5);
    call(morning, 'removeItem', { lineNumber: 1 });
    const withoutCoffee = call(morning, 'getOrderTotal');
    check('discount drops when the coffee goes', withoutCoffee.discount.amount === 0 && withoutCoffee.total === 4.25, withoutCoffee);
    realClock();

    fakeClock('2026-08-24T15:00:00');
    const afternoon = fresh();
    call(afternoon, 'addItemToCart', { itemId: 'matcha-latte', size: 'Large', options: { Temperature: 'Iced', Milk: 'Oat' }, quantity: 2 });
    check('afternoon lull 10% of 11.90 = 1.19', call(afternoon, 'applyPromotion', { promotionId: 'afternoon-lull' }).applied.amount === 1.19);
    check('total 10.71', call(afternoon, 'getOrderTotal').total === 10.71);
    call(afternoon, 'modifyItem', { lineNumber: 1, quantity: 1 });
    const underMinimum = call(afternoon, 'getOrderTotal');
    check('discount drops under the minimum spend', underMinimum.discount.amount === 0 && underMinimum.total === 5.95, underMinimum);
    realClock();

    fakeClock('2026-08-24T11:00:00');
    const midMorning = fresh();
    call(midMorning, 'addItemToCart', { itemId: 'flat-white', size: 'Regular', options: { Milk: 'Whole' } });
    call(midMorning, 'addItemToCart', { itemId: 'cardamom-bun' });
    check('out-of-window promotion refused', call(midMorning, 'applyPromotion', { promotionId: 'early-bird-pairing' }).ok === false);
    check('nothing offered out of window', call(midMorning, 'applyPromotion', {}).available.length === 0);
    realClock();
  }

  section('7. CONFIRMATION GATE');
  {
    const o = fresh();
    check('empty order blocked', call(o, 'finalizeOrder').blockers.includes('the order is empty'));
    call(o, 'addItemToCart', { itemId: 'espresso' });
    check('missing name blocked', call(o, 'finalizeOrder').blockers.includes('no name'));
    call(o, 'pickupDetails', { name: 'Sam' });
    check('a yes with no summary shown places nothing', call(o, 'finalizeOrder', { confirm: true, customerReply: 'yes' }).placed === false);

    const summary = call(o, 'finalizeOrder');
    check('summary returned without placing', summary.ok && summary.placed === false && summary.summary.total === 3, summary);

    const ambiguous = [
      'maybe', 'hold on', 'yes but make it large', 'is that right?', 'sure, and add a croissant',
      'no', '', 'actually cancel it', 'yeah I think so', 'what is the total?', 'i think so',
      'yes if it is under ten dollars',
    ];
    for (const reply of ambiguous) {
      check('ambiguous refused: "' + reply + '"', call(o, 'finalizeOrder', { confirm: true, customerReply: reply }).placed !== true);
    }

    call(o, 'addItemToCart', { itemId: 'almond-biscotti' });
    check('a changed order voids the confirmation', call(o, 'finalizeOrder', { confirm: true, customerReply: 'yes' }).ok === false);

    call(o, 'finalizeOrder');
    const placed = call(o, 'finalizeOrder', { confirm: true, customerReply: 'Yes, please put it in.' });
    check('a clear yes on a fresh summary places it', placed.placed === true && /^CB-\d{8}-[0-9A-F]{8}$/.test(placed.orderId || ''), placed);
    check('status saved as NEW', placed.status === 'NEW');
    check('cannot be placed twice', call(o, 'finalizeOrder', { confirm: true, customerReply: 'yes' }).ok === false);
    check('cart locked after placing', call(o, 'addItemToCart', { itemId: 'espresso' }).ok === false);
    check('details locked after placing', call(o, 'pickupDetails', { name: 'Someone else' }).ok === false);

    for (const reply of ['yes', 'yep', 'go ahead', "that's right", 'sounds good', 'Yes please', 'ok', 'perfect, thanks']) {
      const order = fresh();
      call(order, 'addItemToCart', { itemId: 'espresso' });
      call(order, 'pickupDetails', { name: 'Sam' });
      call(order, 'finalizeOrder');
      check('clear yes accepted: "' + reply + '"', call(order, 'finalizeOrder', { confirm: true, customerReply: reply }).placed === true);
    }

    const delivery = fresh();
    call(delivery, 'addItemToCart', { itemId: 'espresso' });
    call(delivery, 'deliveryDetails', { name: 'Sam', phone: '5550142', address: '18 Larch Road' });
    check('delivery blocked until the address is confirmed', call(delivery, 'finalizeOrder').blockers.some((b) => /read back/.test(b)));
  }

  section('8. FULFILMENT SWITCHING');
  {
    const o = fresh();
    call(o, 'addItemToCart', { itemId: 'espresso' });
    call(o, 'deliveryDetails', { name: 'Sam', phone: '5550142', address: '18 Larch Road' });
    check('pickupDetails switches the order back to pickup', call(o, 'pickupDetails', { name: 'Sam' }).orderType === 'pickup');
    check('no delivery fee once switched', call(o, 'getOrderTotal').deliveryFee === 0);
    check('a switched order can be finalised', call(o, 'finalizeOrder').ok === true);
  }

  section('9. DUPLICATE AND REFINEMENT HANDLING');
  {
    const o = fresh();
    call(o, 'addItemToCart', { itemId: 'butter-croissant' });
    const warmed = call(o, 'addItemToCart', { itemId: 'butter-croissant', options: { Warmed: 'Yes' } });
    check('setting an option applies to the existing line', warmed.ok === true && warmed.changed.lineNumber === 1, warmed);
    check('still one line, warmed recorded', o.items.length === 1 && o.items[0].options.Warmed === 'Yes', o.items);
    check('price did not double', call(o, 'getOrderTotal').total === 3.5);
    check('exact duplicate refused', call(o, 'addItemToCart', { itemId: 'butter-croissant', options: { Warmed: 'Yes' } }).ok === false);
    check('a genuinely different one still adds', call(o, 'addItemToCart', { itemId: 'butter-croissant', options: { Warmed: 'No' } }).ok === true);
    check('total is two croissants', call(o, 'getOrderTotal').total === 7);

    const sizes = fresh();
    call(sizes, 'addItemToCart', { itemId: 'flat-white', size: 'Regular', options: { Milk: 'Oat' } });
    check('a different size is its own line', call(sizes, 'addItemToCart', { itemId: 'flat-white', size: 'Large', options: { Milk: 'Oat' } }).ok === true && sizes.items.length === 2);
    check('total 4.25 + 4.95', call(sizes, 'getOrderTotal').total === 9.2);
  }

  section('10. SAVED RECORD SHAPE');
  {
    const o = fresh();
    call(o, 'addItemToCart', { itemId: 'mocha', size: 'Large', options: { Temperature: 'Iced', Milk: 'Oat' } });
    call(o, 'deliveryDetails', { name: 'Sam', phone: '555 0142', address: '19 Larch Road', unit: '4B' });
    call(o, 'deliveryDetails', { confirmAddress: true });
    call(o, 'finalizeOrder');
    const placed = call(o, 'finalizeOrder', { confirm: true, customerReply: 'yes please' });

    const record = readOrders().find((entry) => entry.orderId === placed.orderId);
    check('record written with the right id and status', record !== undefined && record.status === 'NEW', record && record.status);
    check('timestamp is ISO', /^\d{4}-\d{2}-\d{2}T/.test(record.placedAt));
    check('delivery block carries the confirmed address', record.delivery.address === '19 Larch Road' && record.delivery.unit === '4B' && record.delivery.addressConfirmed === true, record.delivery);
    check('total matches the priced order', record.total === 9.25, record.total);
    check('options survive onto the ticket', record.items[0].options.Temperature === 'Iced' && record.items[0].options.Size === 'Large', record.items[0].options);

    const pickup = fresh();
    call(pickup, 'addItemToCart', { itemId: 'espresso' });
    call(pickup, 'pickupDetails', { name: 'Dev', pickupTime: '08:30' });
    call(pickup, 'finalizeOrder');
    const second = call(pickup, 'finalizeOrder', { confirm: true, customerReply: 'yes' });
    const pickupRecord = readOrders().find((entry) => entry.orderId === second.orderId);
    check('pickup record has no delivery block', pickupRecord.delivery === null && pickupRecord.pickupTime === '08:30', pickupRecord && { delivery: pickupRecord.delivery, pickupTime: pickupRecord.pickupTime });
  }

  section('11. STAFF STATUS SEQUENCE');
  {
    const id = readOrders()[0].orderId;
    check('cannot skip ahead to READY', advanceStatus(id, 'READY').error !== undefined);
    check('NEW -> PREPARING allowed', advanceStatus(id, 'PREPARING').order.status === 'PREPARING');
    check('cannot go back to NEW', advanceStatus(id, 'NEW').error !== undefined);
    check('PREPARING -> READY allowed', advanceStatus(id, 'READY').order.status === 'READY');
    check('READY -> COMPLETED allowed', advanceStatus(id, 'COMPLETED').order.status === 'COMPLETED');
    check('unknown order id is a 404', advanceStatus('CB-19700101-DEADBEEF', 'PREPARING').code === 404);
    check('nonsense status refused', advanceStatus(id, 'CANCELLED').error !== undefined);
  }
} finally {
  if (ordersBefore === null) fs.rmSync(ordersFile, { force: true });
  else fs.writeFileSync(ordersFile, ordersBefore);
}

console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');

if (fails.length > 0) {
  console.log('FAILURES:\n - ' + fails.join('\n - '));
  process.exitCode = 1;
}
