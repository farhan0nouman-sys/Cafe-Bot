const MOCK_REPLY = "Hi! I'm CafeBot. My AI brain isn't connected yet.";
const REPLY_DELAY = 650;

const chat = document.querySelector('#chat');
const panel = document.querySelector('#chat-panel');
const launcher = document.querySelector('#chat-launcher');
const closeButton = document.querySelector('#chat-close');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#chat-input');
const log = document.querySelector('#chat-log');

let replyTimer = null;

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
  clearTimeout(replyTimer);
  removeTyping();
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

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  input.value = '';
  input.focus();

  showTyping();
  clearTimeout(replyTimer);
  replyTimer = setTimeout(() => {
    removeTyping();
    addMessage(MOCK_REPLY, 'bot');
  }, REPLY_DELAY);
});

launcher.hidden = false;
