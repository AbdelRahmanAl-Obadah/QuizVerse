export const state = { user: null, draft: null };
let cleanups = [];
export const onCleanup = (f) => cleanups.push(f);
export function runCleanups() { cleanups.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanups = []; }
export const navigate = (path) => { location.hash = '#' + path; };
