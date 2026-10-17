import { auth, configured, onAuthStateChanged, signOut } from './api.js';
import { touchProfile, finalizeExpiredFor, adminFinalizeAllExpired, clearScoreCache, resetSession } from './services.js';
import { USER_META, clearBoardCache } from './data.js';
import { state, runCleanups, navigate } from './state.js';
import { h, icon, spinner, avatar, toast } from './ui.js';
import { renderLogin } from './views-auth.js';
import * as U from './views-user.js';
import * as A from './views-admin.js';

const root = document.getElementById('app');
const THEME_KEY = 'quizverse-theme'; // non-sensitive preference only
const setTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ } };
setTheme((() => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } })() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
export function themeButton() {
  const b = h('button', { class: 'btn ghost sm', 'aria-label': 'Toggle light/dark theme', onclick: () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); paint(); } });
  const paint = () => b.replaceChildren(icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  paint(); return b;
}

const routes = [
  ['/dashboard', U.dashboard], ['/exams', U.exams], ['/exam/:id', U.runner], ['/results/:id', U.results], ['/history', U.history], ['/leaderboard', U.leaderboard], ['/user/:id', U.profile],
  ['/admin', A.overview, 1], ['/admin/exams', A.exams, 1], ['/admin/exams/edit/:id', A.editor, 1], ['/admin/import', A.importer, 1], ['/admin/users', A.users, 1], ['/admin/attempts', A.attempts, 1], ['/admin/logs', A.logs, 1],
].map(([p, fnc, admin]) => ({ re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fnc, admin: !!admin }));

const NAV = [
  ['/dashboard', 'home', 'Dashboard'], ['/exams', 'book', 'Examinations'], ['/history', 'clock', 'History'], ['/leaderboard', 'trophy', 'Leaderboard'],
];
const ADMIN_NAV = [
  ['/admin', 'shield', 'Overview'], ['/admin/exams', 'list', 'Manage exams'], ['/admin/import', 'upload', 'Import JSON'], ['/admin/users', 'users', 'Users'], ['/admin/attempts', 'clock', 'All attempts'], ['/admin/logs', 'chart', 'Activity logs'],
];
let shell = null;
function buildShell() {
  const link = ([p, i, t]) => h('a', { href: '#' + p, 'data-path': p }, icon(i), h('span', {}, t));
  const logout = () => signOut(auth);
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(link), state.user.role === 'admin' && [h('h4', {}, 'Administration'), ADMIN_NAV.map(link)]);
  const side = h('aside', { class: 'side' },
    h('a', { class: 'brand', href: '#/dashboard' }, h('i', {}, icon('check')), 'QuizVerse'), nav,
    h('div', { class: 'me' }, avatar(state.user.id, state.user.name, 36), h('div', { class: 'grow' }, h('strong', {}, state.user.name), h('div', { class: 'small muted' }, state.user.role === 'admin' ? 'Administrator' : 'Member')), themeButton(),
      h('button', { class: 'btn ghost sm', 'aria-label': 'Sign out', onclick: logout }, icon('logout'))));
  const top = h('div', { class: 'topbar' }, h('strong', {}, 'QuizVerse'), h('div', { class: 'row' }, themeButton(), h('button', { class: 'btn ghost sm', 'aria-label': 'Sign out', onclick: logout }, icon('logout'))));
  const view = h('main', { class: 'main', id: 'view', tabindex: '-1' });
  shell = { el: h('div', { class: 'shell' }, side, h('div', {}, top, view)), view, nav };
  root.replaceChildren(shell.el);
}
function errorBox(e) { return h('div', { class: 'card stack' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'alert' }, e.message || String(e)), h('button', { class: 'btn primary', onclick: route }, 'Try again')); }

let token = 0;
async function route() {
  runCleanups(); clearScoreCache(); clearBoardCache();
  if (!state.user) { shell = null; document.body.classList.remove('focus'); return renderLogin(root); }
  const path = location.hash.slice(1) || '/dashboard';
  const r = routes.find((x) => x.re.test(path));
  if (!r || (r.admin && state.user.role !== 'admin')) return navigate('/dashboard');
  if (!shell) buildShell();
  document.body.classList.toggle('focus', path.startsWith('/exam/'));
  shell.nav.querySelectorAll('a').forEach((a) => { const p = a.dataset.path; if (path === p || (p !== '/admin' && path.startsWith(p + '/'))) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const my = ++token;
  shell.view.replaceChildren(h('div', { class: 'center' }, spinner()));
  try { await r.fnc(shell.view, path.match(r.re).groups || {}, () => my === token); } catch (e) { if (my === token) shell.view.replaceChildren(errorBox(e)); }
}
window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Unexpected error', true));

if (!configured) {
  root.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'card panel stack' }, h('h1', {}, 'Firebase is not configured'), h('p', {}, 'Open public/js/firebase-config.js and paste your Firebase web app configuration. See README.md.'))));
} else {
  onAuthStateChanged(auth, async (u) => {
    state.user = null; resetSession(); clearBoardCache();
    const handle = u?.email?.split('@')[0];
    if (u && USER_META[handle]) {
      // UI-only convenience. Authorization is enforced by Firestore Security Rules, never by this object.
      state.user = { id: handle, name: USER_META[handle].name, role: handle === 'abood' ? 'admin' : 'user' };
      await touchProfile();
      await (handle === 'abood' ? adminFinalizeAllExpired() : finalizeExpiredFor(handle)); // lazy replacement for the old sweeper
    } else if (u) { await signOut(auth); toast('This account is not part of QuizVerse.', true); }
    shell = null; route();
  });
}
