import { auth, fn, signInWithCustomToken } from './api.js';
import { h, icon, avatar, spinner } from './ui.js';
import { USER_META } from './data.js';
import { themeButton } from './app.js';

export async function renderLogin(root) {
  root.replaceChildren(h('main', { class: 'auth' }, spinner()));
  let info;
  try { info = await fn('pinStatus'); }
  catch (e) { root.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'card panel stack' }, h('h1', {}, 'Cannot reach the server'), h('p', { class: 'alert' }, e.message), h('button', { class: 'btn primary', onclick: () => renderLogin(root) }, 'Retry')))); return; }
  const pick = () => {
    root.replaceChildren(h('main', { class: 'auth' },
      h('div', { class: 'hdr' }, h('div', { class: 'brand' }, h('i', {}, icon('check')), 'QuizVerse'), h('h1', {}, 'Who is taking the quiz?'), h('p', { class: 'muted' }, 'Choose your name, then enter your 4-digit PIN.'), themeButton()),
      h('div', { class: 'who' }, Object.entries(USER_META).map(([id, m]) => h('button', { onclick: () => pin(id) }, avatar(id, m.name, 64), h('strong', {}, m.name), h('span', { class: 'small muted' }, info.status[id] ? (m.role === 'admin' ? 'Administrator' : 'Member') : 'Set up your PIN'))))));
  };
  const pin = (id) => {
    const setup = !info.status[id], m = USER_META[id];
    const mk = (label, name, auto) => { const i = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]{4}', maxlength: '4', autocomplete: auto, id: name, 'aria-describedby': 'msg', required: true }); i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 4); }); return { i, row: h('div', { class: 'field' }, h('label', { for: name }, label), h('div', { class: 'pin-wrap' }, i)) }; };
    const p1 = mk(setup ? 'Choose a 4-digit PIN' : '4-digit PIN', 'pin', setup ? 'new-password' : 'current-password');
    const p2 = setup ? mk('Confirm PIN', 'pin2', 'new-password') : null;
    const code = setup && info.setupCodeRequired ? h('input', { id: 'code', type: 'password', autocomplete: 'off', required: true }) : null;
    const msg = h('div', { id: 'msg', class: 'err', role: 'alert' });
    let shown = false;
    const eye = h('button', { type: 'button', 'aria-label': 'Show or hide PIN', onclick: () => { shown = !shown; [p1.i, p2?.i].forEach((x) => x && (x.type = shown ? 'text' : 'password')); eye.replaceChildren(icon(shown ? 'eyeoff' : 'eye')); } }, icon('eye'));
    p1.row.querySelector('.pin-wrap').append(eye);
    const go = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, setup ? 'Save PIN and continue' : 'Sign in');
    const form = h('form', { class: 'card panel', novalidate: true },
      h('div', { class: 'row', style: { marginBottom: '16px' } }, avatar(id, m.name, 48), h('div', {}, h('h2', { style: { margin: 0 } }, m.name), h('span', { class: 'small muted' }, setup ? 'First time here: create a PIN' : 'Welcome back'))),
      p1.row, p2?.row, code && h('div', { class: 'field' }, h('label', { for: 'code' }, 'Setup code'), code), msg, h('div', { class: 'stack', style: { marginTop: '16px' } }, go, h('button', { class: 'btn ghost', type: 'button', style: { width: '100%' }, onclick: pick }, 'Not you? Choose another name')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); msg.textContent = '';
      if (!/^\d{4}$/.test(p1.i.value)) { msg.textContent = 'Enter exactly 4 digits.'; return; }
      if (setup && p1.i.value !== p2.i.value) { msg.textContent = 'The two PINs do not match.'; return; }
      go.disabled = true; go.replaceChildren(spinner(true), ' Please wait');
      try {
        const { token } = await fn('loginWithPin', { userId: id, pin: p1.i.value, mode: setup ? 'setup' : 'login', setupCode: code?.value });
        await signInWithCustomToken(auth, token);
      } catch (e) { msg.textContent = e.message; go.disabled = false; go.textContent = setup ? 'Save PIN and continue' : 'Sign in'; p1.i.value = ''; p2 && (p2.i.value = ''); p1.i.focus(); }
    });
    root.replaceChildren(h('main', { class: 'auth' }, form));
    p1.i.focus();
  };
  pick();
}
