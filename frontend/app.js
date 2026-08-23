const ERROR_REPLY =
  "Sorry — I couldn't reach the café just now. Try again in a moment.";
const HISTORY_TURNS = 10;

const chat = document.querySelector('#chat');
const panel = document.querySelector('#chat-panel');
const launcher = document.querySelector('#chat-launcher');
const closeButton = document.querySelector('#chat-close');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#chat-input');
const sendButton = form.querySelector('.chat-send');
const log = document.querySelector('#chat-log');

const history = [];
let sending = false;

function scrollToLatest() {
  log.scrollTop = log.scrollHeight;
}

function addMessage(text, author) {
  const item = document.createElement('li');
  item.className = `msg msg-${author}`;

  const label = document.createElement('span');
  label.className = 'sr-only';
  label.textContent = author === 'user' ? 'You said:' : 'CafeBot said:';

  const bubble = document.createElement('p');
  bubble.className = 'bubble';
  bubble.textContent = text;

  item.append(label, bubble);
  log.append(item);
  scrollToLatest();
}

function showTyping() {
  if (document.querySelector('#chat-typing')) return;

  const item = document.createElement('li');
  item.className = 'msg msg-bot';
  item.id = 'chat-typing';

  const bubble = document.createElement('p');
  bubble.className = 'bubble bubble-typing';
  bubble.setAttribute('aria-label', 'CafeBot is typing');
  for (let i = 0; i < 3; i += 1) {
    bubble.append(document.createElement('span'));
  }

  item.append(bubble);
  log.append(item);
  scrollToLatest();
}

function removeTyping() {
  document.querySelector('#chat-typing')?.remove();
}

function openChat() {
  panel.hidden = false;
  panel.inert = false;
  panel.classList.add('is-open');
  chat.classList.add('is-open');
  launcher.setAttribute('aria-expanded', 'true');
  input.focus();
  scrollToLatest();
}

function closeChat() {
  panel.hidden = true;
  panel.inert = true;
  panel.classList.remove('is-open');
  chat.classList.remove('is-open');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.focus();
}

launcher.addEventListener('click', () => {
  if (chat.classList.contains('is-open')) {
    closeChat();
  } else {
    openChat();
  }
});

closeButton.addEventListener('click', closeChat);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && chat.classList.contains('is-open')) {
    closeChat();
  }
});

async function askCafeBot(text) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: text,
      conversationHistory: history.slice(-HISTORY_TURNS),
    }),
  });

  const data = await response.json().catch(() => ({}));
  return typeof data.reply === 'string' && data.reply ? data.reply : ERROR_REPLY;
}

function setSending(state) {
  sending = state;
  input.disabled = state;
  sendButton.disabled = state;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text || sending) return;

  addMessage(text, 'user');
  input.value = '';
  setSending(true);
  showTyping();

  let reply = ERROR_REPLY;
  try {
    reply = await askCafeBot(text);
    history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
  } catch {
    // Leave the failed exchange out of the history sent on the next attempt.
  }

  removeTyping();
  addMessage(reply, 'bot');

  setSending(false);
  if (chat.classList.contains('is-open')) input.focus();
});

launcher.hidden = false;
