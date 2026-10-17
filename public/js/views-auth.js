import { h, icon, avatar, spinner } from './ui.js';
import { USER_META } from './data.js';
import { login } from './services.js';
import { themeButton } from './app.js';

export const PIN_LENGTH = 6; // Firebase Auth passwords need at least 6 characters
export function renderLogin(root) {
  const pick = () => {
    root.replaceChildren(h('main', { class: 'auth' },
      h('div', { class: 'hdr' }, h('div', { class: 'brand' }, h('i', {}, icon('check')), 'QuizVerse'), h('h1', {}, 'Who is taking the quiz?'), h('p', { class: 'muted' }, `Choose your name, then enter your ${PIN_LENGTH}-digit PIN.`), themeButton()),
      h('div', { class: 'who' }, Object.entries(USER_META).map(([id, m]) => h('button', { onclick: () => pin(id) }, avatar(id, m.name, 64), h('strong', {}, m.name), h('span', { class: 'small muted' }, m.role === 'admin' ? 'Administrator' : 'Member'))))));
  };
  const pin = (id) => {
    const m = USER_META[id];
    const i = h('input', { type: 'password', inputmode: 'numeric', pattern: `[0-9]{${PIN_LENGTH}}`, maxlength: String(PIN_LENGTH), autocomplete: 'current-password', id: 'pin', 'aria-describedby': 'msg', required: true });
    i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, PIN_LENGTH); });
    const msg = h('div', { id: 'msg', class: 'err', role: 'alert' });
    let shown = false;
    const eye = h('button', { type: 'button', 'aria-label': 'Show or hide PIN', onclick: () => { shown = !shown; i.type = shown ? 'text' : 'password'; eye.replaceChildren(icon(shown ? 'eyeoff' : 'eye')); } }, icon('eye'));
    const go = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'Sign in');
    const form = h('form', { class: 'card panel', novalidate: true },
      h('div', { class: 'row', style: { marginBottom: '16px' } }, avatar(id, m.name, 48), h('div', {}, h('h2', { style: { margin: 0 } }, m.name), h('span', { class: 'small muted' }, 'Welcome back'))),
      h('div', { class: 'field' }, h('label', { for: 'pin' }, `${PIN_LENGTH}-digit PIN`), h('div', { class: 'pin-wrap' }, i, eye)), msg,
      h('p', { class: 'small muted' }, 'Forgotten PIN? Ask Abood to reset it in the Firebase console.'),
      h('div', { class: 'stack', style: { marginTop: '16px' } }, go, h('button', { class: 'btn ghost', type: 'button', style: { width: '100%' }, onclick: pick }, 'Not you? Choose another name')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); msg.textContent = '';
      if (i.value.length !== PIN_LENGTH) { msg.textContent = `Enter exactly ${PIN_LENGTH} digits.`; return; }
      go.disabled = true; go.replaceChildren(spinner(true), ' Please wait');
      try { await login(id, i.value); } // app.js reacts to the auth state change
      catch (e) { msg.textContent = e.message; go.disabled = false; go.textContent = 'Sign in'; i.value = ''; i.focus(); }
    });
    root.replaceChildren(h('main', { class: 'auth' }, form)); i.focus();
  };
  pick();
}
