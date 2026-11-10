'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCourse } = require('./load');

const { lib } = loadCourse();
const plain = x => JSON.parse(JSON.stringify(x));
const { fresh, sanitizeState, serializeState, parseImport, mergeStates, parseNum, plural, normFill, fillOk, sameSet, riceScore, LIMITS } = lib;

test('склонение по числу', () => {
  const f = ['ошибка', 'ошибки', 'ошибок'];
  assert.equal(lib.plural(1, f), 'ошибка');
  assert.equal(lib.plural(2, f), 'ошибки');
  assert.equal(lib.plural(5, f), 'ошибок');
  assert.equal(lib.plural(11, f), 'ошибок');
  assert.equal(lib.plural(21, f), 'ошибка');
  assert.equal(lib.plural(112, f), 'ошибок');
});

test('разбор чисел и проверка коротких ответов', () => {
  assert.equal(parseNum('12,5'), 12.5);
  assert.equal(parseNum(' 1 000 '), 1000);
  assert.ok(Number.isNaN(parseNum('abc')));
  assert.ok(Number.isNaN(parseNum('')));
  assert.equal(normFill(' «Ёлка» '), 'елка');
  assert.ok(fillOk('Ёж', ['еж']));
  assert.ok(sameSet([1, 2], [2, 1]) && !sameSet([1], [1, 2]));
});

test('RICE', () => {
  assert.equal(riceScore(4000, 2, 50, 4), 1000);
  assert.ok(Number.isNaN(riceScore(1, 1, 100, 0)));
});

test('очистка состояния отбрасывает лишнее и неверное', () => {
  assert.equal(sanitizeState(null), null);
  assert.equal(sanitizeState({ v: 2 }), null);
  assert.equal(sanitizeState([]), null);
  const s = sanitizeState({
    v: 1, done: { m1: 1, '__proto__': 1, 'плохой ключ': 1 }, last: 'm2',
    quiz: { m1: { best: 99, total: 5 }, x: 'не объект' }, qprog: { m1: 'cwc-', m2: 'zzz' },
    notes: { a: { t: 'текст', ts: 5 }, b: { t: 'x'.repeat(LIMITS.note + 1) } },
    cards: { c1: { k: 1, ts: 1 }, c2: { k: 9 } },
    lab: { t1: { ok: 1, ts: 3, d: '{"nodes":[]}' }, t2: { ok: 0, d: 'x'.repeat(LIMITS.diagram + 1) }, t3: 5 },
    sql: { s1: { ok: 1, q: 'SELECT 1' }, s2: { ok: 0 } }, extra: 'лишнее'
  });
  assert.deepEqual(plain(Object.keys(s.done)), ['m1']);
  assert.equal(s.quiz.m1.best, 5);
  assert.ok(!('x' in s.quiz));
  assert.equal(s.qprog.m1, 'cwc-');
  assert.ok(!('m2' in s.qprog));
  assert.ok('a' in s.notes && !('b' in s.notes));
  assert.deepEqual(plain(Object.keys(s.cards)), ['c1']);
  assert.equal(s.lab.t1.ok, 1);
  assert.ok(!('t2' in s.lab) && !('t3' in s.lab));
  assert.equal(s.sql.s1.q, 'SELECT 1');
  assert.ok(!('s2' in s.sql));
  assert.ok(!('extra' in s));
});

test('экспорт и импорт прогресса', () => {
  const st = fresh();
  st.done.m3 = true; st.lab.t1 = { ok: 1, ts: 10, d: '{"a":1}' }; st.ts = 50;
  const text = serializeState(st, 0);
  const r = parseImport(text);
  assert.ok(r.ok);
  assert.equal(r.state.done.m3, true);
  assert.equal(r.state.lab.t1.d, '{"a":1}');
  assert.ok(!parseImport('').ok);
  assert.ok(!parseImport('{{{').ok);
  assert.ok(!parseImport(JSON.stringify({ app: 'чужой', v: 1, state: st })).ok);
  assert.ok(!parseImport(JSON.stringify({ app: lib.APP_ID, v: 7, state: st })).ok);
  assert.ok(!parseImport(JSON.stringify({ app: lib.APP_ID, v: 1, state: { v: 3 } })).ok);
  assert.ok(!parseImport('x'.repeat(LIMITS.file + 1)).ok);
});

test('слияние не теряет пройденное', () => {
  const a = fresh(), b = fresh();
  a.done.m1 = true; b.done.m2 = true;
  a.quiz.m1 = { best: 4, total: 6, last: 4 }; b.quiz.m1 = { best: 6, total: 6, last: 2 };
  a.qprog.m1 = 'cccw--'; b.qprog.m1 = 'cc----';
  a.lab.t1 = { ok: 1, ts: 100, d: 'старый' }; b.lab.t1 = { ok: 0, ts: 200, d: 'новый' };
  a.sql.s1 = { ok: 0, ts: 300, q: 'a' }; b.sql.s1 = { ok: 1, ts: 100, q: 'b' };
  a.notes.p = { t: 'старая', ts: 1 }; b.notes.p = { t: 'новая', ts: 2 };
  a.ts = 10; b.ts = 20; a.last = 'm1'; b.last = 'm2';
  const m = mergeStates(a, b);
  assert.deepEqual(plain(Object.keys(m.done).sort()), ['m1', 'm2']);
  assert.equal(m.quiz.m1.best, 6);
  assert.equal(m.qprog.m1, 'cccw--');
  assert.equal(m.lab.t1.ok, 1, 'отметка «выполнено» не теряется');
  assert.equal(m.lab.t1.d, 'новый', 'схема берётся более свежая');
  assert.equal(m.sql.s1.ok, 1);
  assert.equal(m.sql.s1.q, 'a');
  assert.equal(m.notes.p.t, 'новая');
  assert.equal(m.last, 'm2');
  assert.deepEqual(plain(sanitizeState(m)), plain(m));
});
