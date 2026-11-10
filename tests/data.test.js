'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCourse } = require('./load');

const { COURSE, CARDS, GLOSS, WIDGETS, SOURCES, BPMN_TASKS, SQL_TASKS, PARTS } = loadCourse();

test('пятнадцать модулей с уникальными идентификаторами по порядку', () => {
  assert.equal(COURSE.length, 15);
  assert.deepEqual(Array.from(COURSE, m => m.id), Array.from({ length: 15 }, (_, i) => 'm' + (i + 1)));
});

test('у каждого модуля есть всё необходимое', () => {
  const parts = new Set(Array.from(PARTS, p => p.id));
  for (const m of COURSE) {
    for (const k of ['short', 'title', 'lead', 'body']) assert.ok(typeof m[k] === 'string' && m[k].length > 0, m.id + ' ' + k);
    for (const k of ['learn', 'takeaways', 'quiz']) assert.ok(Array.isArray(m[k]) && m[k].length > 0, m.id + ' ' + k);
    assert.ok(parts.has(m.part), m.id + ' part');
    assert.ok(m.minutes > 0, m.id + ' minutes');
    const p = m.practice;
    assert.ok(p && p.id && p.title && p.brief && p.template && p.model, m.id + ' practice');
    assert.ok(Array.isArray(p.checks) && p.checks.length > 0, m.id + ' checks');
  }
});

test('идентификаторы практических заданий уникальны', () => {
  const ids = COURSE.map(m => m.practice.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('модули сгруппированы по частям подряд', () => {
  const order = COURSE.map(m => m.part).join('');
  assert.equal(order, 'aaaaabbbbccccdd');
});

test('вопросы корректны: у каждого есть пояснение, ответ в допустимых пределах', () => {
  let total = 0;
  for (const m of COURSE) {
    assert.ok(m.quiz.length >= 6, m.id + ' мало вопросов: ' + m.quiz.length);
    for (const q of m.quiz) {
      total++;
      const t = q.type || 'mc';
      assert.ok(q.q && q.why, m.id + ' вопросу нужны текст и пояснение');
      if (t === 'mc') {
        assert.ok(Array.isArray(q.o) && q.o.length >= 2, m.id + ' варианты');
        assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length, m.id + ' индекс ответа');
        assert.equal(new Set(q.o).size, q.o.length, m.id + ' повторяющиеся варианты');
      } else if (t === 'multi') {
        assert.ok(Array.isArray(q.o) && q.o.length >= 3, m.id + ' multi варианты');
        assert.ok(Array.isArray(q.a) && q.a.length >= 1 && q.a.length < q.o.length, m.id + ' multi ответы');
        assert.ok(q.a.every(i => Number.isInteger(i) && i >= 0 && i < q.o.length), m.id + ' multi индексы');
        assert.equal(new Set(q.o).size, q.o.length, m.id + ' повторяющиеся варианты');
      } else if (t === 'num') {
        assert.equal(typeof q.ans, 'number', m.id + ' числовой ответ');
      } else if (t === 'order') {
        assert.ok(Array.isArray(q.items) && q.items.length >= 3, m.id + ' порядок');
        assert.equal(new Set(q.items).size, q.items.length, m.id + ' повторяющиеся шаги');
      } else {
        assert.fail(m.id + ' неизвестный тип вопроса ' + t);
      }
    }
  }
  assert.ok(total >= 90, 'вопросов всего: ' + total);
});

test('каждый тренажёр из текста существует, и каждый зарегистрированный тренажёр где-то используется', () => {
  const used = new Set();
  for (const m of COURSE) {
    for (const mt of m.body.matchAll(/\{\{w:([\w-]+)\}\}/g)) {
      assert.ok(WIDGETS[mt[1]], m.id + ' использует неизвестный тренажёр ' + mt[1]);
      assert.equal(typeof WIDGETS[mt[1]].init, 'function', mt[1]);
      assert.ok(WIDGETS[mt[1]].title, mt[1]);
      used.add(mt[1]);
    }
  }
  /* страница «Задания по BPMN» использует свободный холст отдельно, но он есть и в модуле 9 */
  const unused = Object.keys(WIDGETS).filter(n => !used.has(n));
  assert.deepEqual(Array.from(unused), []);
});

test('задания BPMN: уникальные идентификаторы, у каждого условие, эталон и проверки', () => {
  const ids = BPMN_TASKS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(BPMN_TASKS.filter(t => !t.free).length >= 11);
  for (const t of BPMN_TASKS) {
    assert.ok(t.title && t.brief && t.ref && t.mod, t.id);
    assert.ok(COURSE.some(m => m.id === t.mod), t.id + ' модуль ' + t.mod);
    const mod = COURSE.find(m => m.id === t.mod);
    assert.ok(mod.body.includes('{{w:bp-' + t.id + '}}'), t.id + ' не размещено в модуле ' + t.mod);
    if (!t.free) assert.ok(t.checks.length >= 3 && Array.isArray(t.hints) && t.hints.length >= 2, t.id + ' проверки и подсказки');
    for (const c of t.checks) assert.ok(c.t && typeof c.f === 'function', t.id + ' проверка');
  }
});

test('задания SQL: уникальные идентификаторы и размещение в модуле 12', () => {
  const ids = SQL_TASKS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(SQL_TASKS.filter(t => !t.free).length >= 7);
  const mod = COURSE.find(m => m.id === 'm12');
  for (const t of SQL_TASKS) {
    assert.ok(t.title && t.brief && t.solution, t.id);
    assert.ok(mod.body.includes('{{w:sql-' + t.id + '}}'), t.id + ' не размещено в модуле 12');
  }
});

test('карточки: уникальные идентификаторы, есть вопрос и ответ', () => {
  const ids = CARDS.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(CARDS.length >= 40);
  for (const c of CARDS) assert.ok(c.tag && c.q && c.a, c.id);
});

test('глоссарий: уникальные термины с определением, отсортирован', () => {
  assert.ok(GLOSS.length >= 80);
  const terms = GLOSS.map(g => g.t);
  assert.equal(new Set(terms).size, terms.length, 'повторяющиеся термины');
  for (const g of GLOSS) assert.ok(g.t && g.d, g.t);
  const sorted = terms.slice().sort((a, b) => a.localeCompare(b, 'ru'));
  assert.deepEqual(Array.from(terms), Array.from(sorted));
});

test('у каждого модуля есть источники по https', () => {
  for (const m of COURSE) {
    const list = SOURCES[m.id];
    assert.ok(Array.isArray(list) && list.length > 0, m.id + ' источники');
    for (const s of list) assert.ok(s.t && /^https:\/\//.test(s.u), m.id + ' ' + s.u);
  }
});

test('ключ ответов не изменился при правке текста', () => {
  const key = {};
  for (const m of COURSE) key[m.id] = Array.from(m.quiz, q => { const t = q.type || 'mc'; return t === 'mc' ? 'mc' + q.a : t === 'multi' ? 'multi' + q.a.join('') : t === 'num' ? 'num' + q.ans : 'order' + q.items.length; });
  assert.deepEqual(JSON.parse(JSON.stringify(key)), require('./answer-key.json'));
});
