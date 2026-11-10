'use strict';
/* Чистые функции без обращения к DOM. В браузере подключается обычным скриптом, в тестах Node через vm.
   Здесь помощники для текста курса, проверка ответов и логика состояния прогресса. */

/* ===== помощники для текста курса ===== */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tbl = (head, rows) => '<div class="tbl"><table><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
const co = (title, txt, warn) => `<div class="callout${warn ? ' warn' : ''}"><b>${title}</b>${txt}</div>`;
/* Пример кода или запроса в тексте модуля. */
const pre = s => `<pre class="mono-box">${esc(s)}</pre>`;
/* RICE: охват * влияние * уверенность (в процентах) / трудозатраты. */
function riceScore(reach, impact, confidencePct, effort) { return effort > 0 ? reach * impact * (confidencePct / 100) / effort : NaN; }
/* Склонение по числу: plural(5, ['ошибка', 'ошибки', 'ошибок']) */
function plural(n, f) {
  n = Math.abs(Math.floor(n));
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return f[0];
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return f[1];
  return f[2];
}

/* Число с точкой или запятой в качестве десятичного разделителя. Возвращает NaN, если это не число. */
function parseNum(s) {
  const t = String(s == null ? '' : s).trim().replace(/\s+/g, '').replace(',', '.');
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : NaN;
}
const fmt = (n, d = 2) => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });

/* ===== проверка ответов ===== */
/* Короткий ответ сравнивается без регистра, кавычек и лишних пробелов; ё и е считаются одной буквой. */
function normFill(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[`"'«»]/g, '').replace(/\s+/g, ' ').trim(); }
function fillOk(input, accepted) { const n = normFill(input); return n !== '' && accepted.some(a => normFill(a) === n); }
/* Вопрос с несколькими верными вариантами считается верным, только если выбранный набор равен верному. */
function sameSet(a, b) {
  const x = new Set(a), y = new Set(b);
  return x.size === y.size && [...x].every(v => y.has(v));
}

/* ===== состояние прогресса: форма, очистка, экспорт, импорт, слияние ===== */
const APP_ID = 'business-analyst-course-ru';
const LS_KEY = 'business-analyst-course-ru.v1';
const LIMITS = { keys: 400, note: 20000, diagram: 40000, query: 3000, file: 3000000, quizTotal: 200 };
const KEY_RE = /^[A-Za-z0-9_:-]{1,40}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const fresh = () => ({ v: 1, done: {}, quiz: {}, qprog: {}, notes: {}, cards: {}, lab: {}, sql: {}, last: '', ts: 0 });

function clampInt(n, lo, hi) { n = Math.floor(+n); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; }
function clampTs(n) { n = +n; return isFinite(n) && n > 0 && n < 4e12 ? Math.floor(n) : 0; }
function eachKey(obj, fn) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  let n = 0;
  for (const k of Object.keys(obj)) {
    if (!KEY_RE.test(k) || BAD_KEYS.has(k)) continue;
    if (++n > LIMITS.keys) break;
    fn(k, obj[k]);
  }
}
/* Возвращает чистую копию состояния или null, если форма неверная. Неизвестные ключи и слишком большие значения отбрасываются. */
function sanitizeState(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
  const s = fresh();
  eachKey(o.done, (k, v) => { if (v) s.done[k] = true; });
  eachKey(o.lab, (k, v) => {
    if (!v || typeof v !== 'object') return;
    const e = { ok: v.ok ? 1 : 0, ts: clampTs(v.ts) };
    if (typeof v.d === 'string' && v.d.length <= LIMITS.diagram) e.d = v.d;
    if (e.ok || e.d) s.lab[k] = e;
  });
  eachKey(o.sql, (k, v) => {
    if (!v || typeof v !== 'object') return;
    const e = { ok: v.ok ? 1 : 0, ts: clampTs(v.ts) };
    if (typeof v.q === 'string' && v.q.length <= LIMITS.query) e.q = v.q;
    if (e.ok || e.q) s.sql[k] = e;
  });
  eachKey(o.quiz, (k, v) => {
    if (!v || typeof v !== 'object') return;
    const total = clampInt(v.total, 1, LIMITS.quizTotal), best = clampInt(v.best, 0, total);
    s.quiz[k] = { best, total, last: clampInt(v.last == null ? best : v.last, 0, total) };
  });
  eachKey(o.qprog, (k, v) => { if (typeof v === 'string' && /^[cw-]{1,100}$/.test(v)) s.qprog[k] = v; });
  eachKey(o.notes, (k, v) => { if (v && typeof v === 'object' && typeof v.t === 'string' && v.t.length <= LIMITS.note) s.notes[k] = { t: v.t, ts: clampTs(v.ts) }; });
  eachKey(o.cards, (k, v) => { if (v && typeof v === 'object' && (v.k === 1 || v.k === 2)) s.cards[k] = { k: v.k, ts: clampTs(v.ts) }; });
  if (typeof o.last === 'string' && KEY_RE.test(o.last) && !BAD_KEYS.has(o.last)) s.last = o.last;
  s.ts = clampTs(o.ts);
  return s;
}
function serializeState(state, now) {
  const clean = sanitizeState(state) || fresh();
  return JSON.stringify({ app: APP_ID, v: 1, exported: new Date(now == null ? Date.now() : now).toISOString(), state: clean }, null, 1);
}
/* Разбирает текст экспортированного файла. Никогда не бросает исключение. */
function parseImport(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Файл пустой.' };
  if (text.length > LIMITS.file) return { ok: false, error: 'Файл слишком большой.' };
  let o;
  try { o = JSON.parse(text); } catch (e) { return { ok: false, error: 'Файл не является корректным JSON.' }; }
  if (!o || typeof o !== 'object' || o.app !== APP_ID) return { ok: false, error: 'Это не файл прогресса из этого курса.' };
  if (o.v !== 1) return { ok: false, error: 'Эта версия файла не поддерживается.' };
  const s = sanitizeState(o.state);
  if (!s) return { ok: false, error: 'Данные прогресса в файле повреждены.' };
  return { ok: true, state: s };
}
const answered = str => (str || '').replace(/-/g, '').length;
function mergeNewer(x, y) {
  const out = {};
  new Set(Object.keys(x || {}).concat(Object.keys(y || {}))).forEach(k => {
    const p = (x || {})[k], q = (y || {})[k];
    out[k] = !p ? q : (!q ? p : ((q.ts || 0) >= (p.ts || 0) ? q : p));
  });
  return out;
}
/* Слияние оставляет лучшее с обеих сторон и никогда не теряет завершённый модуль или пройденное задание. При равенстве выигрывает b. */
function mergeStates(a, b) {
  const out = fresh();
  out.done = Object.assign({}, a.done, b.done);
  [['lab', 'd'], ['sql', 'q']].forEach(([name, field]) => {
    new Set(Object.keys(a[name] || {}).concat(Object.keys(b[name] || {}))).forEach(k => {
      const x = (a[name] || {})[k] || {}, y = (b[name] || {})[k] || {};
      const newer = (y.ts || 0) >= (x.ts || 0) ? y : x, older = newer === y ? x : y;
      const e = { ok: (x.ok || y.ok) ? 1 : 0, ts: Math.max(x.ts || 0, y.ts || 0) };
      const val = newer[field] != null ? newer[field] : older[field];
      if (val != null) e[field] = val;
      out[name][k] = e;
    });
  });
  new Set(Object.keys(a.quiz || {}).concat(Object.keys(b.quiz || {}))).forEach(k => {
    const x = (a.quiz || {})[k], y = (b.quiz || {})[k];
    out.quiz[k] = !x ? y : (!y ? x : ((y.best || 0) >= (x.best || 0) ? y : x));
  });
  new Set(Object.keys(a.qprog || {}).concat(Object.keys(b.qprog || {}))).forEach(k => {
    const x = (a.qprog || {})[k], y = (b.qprog || {})[k];
    out.qprog[k] = !x ? y : (!y ? x : (answered(y) >= answered(x) ? y : x));
  });
  out.notes = mergeNewer(a.notes, b.notes);
  out.cards = mergeNewer(a.cards, b.cards);
  out.ts = Math.max(a.ts || 0, b.ts || 0);
  /* Последний открытый модуль берётся с той стороны, которая использовалась позже. */
  out.last = (b.ts || 0) >= (a.ts || 0) ? (b.last || a.last || '') : (a.last || b.last || '');
  return out;
}
function doneCount(state, ids) { return ids.filter(id => state.done[id]).length; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, tbl, co, pre, plural, riceScore, parseNum, fmt, normFill, fillOk, sameSet, APP_ID, LS_KEY, LIMITS, fresh, sanitizeState, serializeState, parseImport, mergeStates, answered, doneCount };
}
