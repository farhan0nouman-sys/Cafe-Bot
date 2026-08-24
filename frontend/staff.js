const NEXT = { NEW: 'PREPARING', PREPARING: 'READY', READY: 'COMPLETED' };
const POLL = 15000;

const list = document.querySelector('#orders');
const empty = document.querySelector('#empty');
const count = document.querySelector('#count');

function line(label, value) {
  const row = document.createElement('p');
  row.className = 'row';

  const key = document.createElement('span');
  key.className = 'key';
  key.textContent = label;

  const val = document.createElement('span');
  val.textContent = value;

  row.append(key, val);
  return row;
}

function itemList(items) {
  const ul = document.createElement('ul');
  ul.className = 'items';

  for (const item of items) {
    const li = document.createElement('li');
    const options = Object.entries(item.options)
      .map(([name, value]) => (name === 'Size' ? value : `${name}: ${value}`))
      .join(', ');
    li.textContent = `${item.quantity} × ${item.name}${options ? ` (${options})` : ''}`;
    ul.append(li);
  }

  return ul;
}

function who(order) {
  if (order.orderType === 'delivery') {
    const parts = [order.delivery.address, order.delivery.unit].filter(Boolean);
    return [
      line('Name', order.customer.name),
      line('Phone', order.customer.phone),
      line('Address', parts.join(', ')),
      order.delivery.instructions ? line('Notes', order.delivery.instructions) : null,
    ].filter(Boolean);
  }

  return [
    line('Name', order.customer.name),
    line('Pickup', order.pickupTime ?? 'as soon as ready'),
  ];
}

async function advance(orderId, status, button) {
  button.disabled = true;

  const response = await fetch(`/api/orders/${orderId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) button.disabled = false;
  await load();
}

function card(order) {
  const li = document.createElement('li');
  li.className = `card status-${order.status.toLowerCase()}`;

  const head = document.createElement('div');
  head.className = 'head';

  const id = document.createElement('h2');
  id.textContent = order.orderId;

  const badges = document.createElement('p');
  badges.className = 'badges';

  const type = document.createElement('span');
  type.className = `badge type-${order.orderType}`;
  type.textContent = order.orderType;

  const status = document.createElement('span');
  status.className = 'badge state';
  status.textContent = order.status;

  badges.append(type, status);
  head.append(id, badges);

  const total = document.createElement('p');
  total.className = 'total';
  total.textContent = `$${order.total.toFixed(2)}`;

  const foot = document.createElement('div');
  foot.className = 'foot';

  const placed = document.createElement('span');
  placed.className = 'placed';
  placed.textContent = new Date(order.placedAt).toLocaleString();
  foot.append(placed);

  const next = NEXT[order.status];
  if (next) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Mark ${next}`;
    button.addEventListener('click', () => advance(order.orderId, next, button));
    foot.append(button);
  }

  li.append(head, itemList(order.items), ...who(order), total, foot);
  return li;
}

async function load() {
  const response = await fetch('/api/orders');
  const { orders } = await response.json();

  list.replaceChildren(...orders.map(card));
  empty.hidden = orders.length > 0;
  count.textContent = `${orders.filter((order) => order.status !== 'COMPLETED').length} open`;
}

document.querySelector('#refresh').addEventListener('click', load);
setInterval(load, POLL);
load();
