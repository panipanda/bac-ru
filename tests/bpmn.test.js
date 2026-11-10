'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCourse } = require('./load');

const { BPMN: B, BPMN_TASKS } = loadCourse();
const dsl = {
  ok: `N s1 s 0,0 "Заказ принят"
N t1 t 1,0 "Проверить заказ"
N g1 x 2,0 "Заказ верный?"
N t2 t 3,0 "Собрать заказ"
N e1 e 4,0 "Заказ собран"
N e2 e 3,1 "Заказ отклонён"
E s1 t1
E t1 g1
E g1 t2 "Да"
E g1 e2 "Нет"
E t2 e1`,
  andXor: `N s1 s 0,1 "Начало"
N a1 a 1,1
N t1 t 2,0 "Собрать заказ"
N t2 t 2,2 "Подготовить документы"
N x1 x 3,1
N t3 t 4,1 "Отправить заказ"
N e1 e 5,1 "Заказ отправлен"
E s1 a1
E a1 t1
E a1 t2
E t1 x1
E t2 x1
E x1 t3
E t3 e1`,
  xorAnd: `N s1 s 0,1 "Начало"
N x1 x 1,1 "Оплата картой?"
N t1 t 2,0 "Списать с карты"
N t2 t 2,2 "Выставить счёт"
N a1 a 3,1
N t3 t 4,1 "Собрать заказ"
N e1 e 5,1 "Заказ собран"
E s1 x1
E x1 t1 "Да"
E x1 t2 "Нет"
E t1 a1
E t2 a1
E a1 t3
E t3 e1`
};
const plain = x => JSON.parse(JSON.stringify(x));
const codes = m => B.lint(m).map(x => x.code);

test('краткая запись: позиции, пулы, дорожки, чёрные ящики, граничные события', () => {
  const m = B.parseDsl(`P Клиент!\nP Магазин: Склад | Касса(200)\nN s1 s 0,1 "Старт"\nN t1 t 1,0 "Шаг"\nB b1 t1 timer "Срок" ni\nE s1 t1`);
  assert.equal(m.pools.length, 2);
  assert.equal(m.pools[0].bb, true);
  assert.equal(m.pools[1].lanes.length, 2);
  assert.equal(m.pools[1].lanes[1].h, 200);
  const L = B.layout(m);
  assert.equal(L.lanes.length, 2);
  const s1 = m.nodes.find(n => n.id === 's1'), b1 = m.nodes.find(n => n.id === 'b1');
  assert.equal(B.laneOf(L, s1).name, 'Касса');
  assert.equal(b1.t, 'bnd');
  assert.equal(b1.ni, true);
  assert.ok(Number.isFinite(b1.x) && Number.isFinite(b1.y));
  assert.throws(() => B.parseDsl('N z q 0,0 "x"'));
});

test('рисование: SVG для всех эталонов без NaN и undefined, потоки идут под прямым углом', () => {
  for (const t of BPMN_TASKS) {
    for (const src of [t.ref, t.start].filter(Boolean)) {
      const m = B.parseDsl(src);
      const svg = B.renderSvg(m);
      assert.ok(svg.startsWith('<svg'), t.id);
      assert.ok(!/NaN|undefined|Infinity/.test(svg), t.id + ' содержит NaN или undefined');
      const L = B.layout(m), I = B.idx(m);
      for (const e of m.edges) {
        const pts = B.route(m, L, I, e);
        assert.ok(pts.length >= 2, t.id + ' поток ' + e.id);
        for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) < 0.6 || Math.abs(pts[i][1] - pts[i - 1][1]) < 0.6, t.id + ' косой отрезок на потоке ' + e.id);
      }
    }
  }
});

test('эталоны заданий проходят собственные проверки и не имеют ошибок и предупреждений', () => {
  for (const t of BPMN_TASKS) {
    const m = B.parseDsl(t.ref);
    const l = B.lint(m).filter(x => x.lvl !== 'tip');
    assert.deepEqual(plain(l.map(x => x.code + ' ' + x.msg)), [], t.id + ' эталон имеет замечания');
    const M = B.checker(m);
    for (const c of t.checks) assert.ok(c.f(M), t.id + ' эталон не проходит проверку: ' + c.t);
    const a = B.analyze(m);
    assert.ok(a.completed && !a.deadlock && a.multi.length === 0 && !a.unbounded && !a.truncated, t.id + ' анализ эталона');
  }
});

test('стартовые схемы заданий не проходят проверки сами по себе', () => {
  for (const t of BPMN_TASKS) {
    if (t.free || !t.checks.length) continue;
    const m = t.start ? B.parseDsl(t.start) : B.empty();
    const M = B.checker(m);
    const pass = t.checks.filter(c => { try { return c.f(M); } catch (e) { return false; } });
    assert.ok(pass.length < t.checks.length, t.id + ' уже выполнено без работы');
  }
});

test('задание «Найдите ошибки»: исходная схема содержит ошибки всех нужных видов', () => {
  const t = BPMN_TASKS.find(x => x.id === 't9');
  const l = codes(B.parseDsl(t.start));
  for (const c of ['GATE_LABELS', 'DEAD_END', 'IMPLICIT_SPLIT', 'SIM_MULTI']) assert.ok(l.includes(c), 'нет ' + c + ' среди ' + l.join(','));
});

test('проверка структуры: типичные ошибки находятся', () => {
  const m = B.parseDsl(dsl.ok);
  assert.equal(B.lint(m).filter(x => x.lvl !== 'tip').length, 0);
  assert.ok(codes(B.empty()).includes('EMPTY'));
  const noEnd = B.parseDsl('N s1 s 0,0 "Старт"\nN t1 t 1,0 "Сделать работу"\nE s1 t1');
  assert.ok(codes(noEnd).includes('NO_END') && codes(noEnd).includes('DEAD_END'));
  const noStart = B.parseDsl('N t1 t 0,0 "Сделать работу"\nN e1 e 1,0 "Готово"\nE t1 e1');
  assert.ok(codes(noStart).includes('NO_START') && codes(noStart).includes('NO_IN'));
  const mixed = B.parseDsl('N s1 s 0,0 "Начало"\nN s2 s 0,1 "Иное начало"\nN g1 x 1,0 "Выбор?"\nN t1 t 2,0 "Шаг А"\nN t2 t 2,1 "Шаг Б"\nN e1 e 3,0 "Конец"\nE s1 g1\nE s2 g1\nE g1 t1 "Да"\nE g1 t2 "Нет"\nE t1 e1\nE t2 e1');
  assert.ok(codes(mixed).includes('GATE_MIXED'));
  const emptyTask = B.parseDsl('N s1 s 0,0 "Начало"\nN t1 t 1,0 ""\nN e1 e 2,0 "Конец"\nE s1 t1\nE t1 e1');
  assert.ok(codes(emptyTask).includes('TASK_EMPTY'));
  const nounTask = B.parseDsl('N s1 s 0,0 "Начало"\nN t1 t 1,0 "Проверка заявки"\nN e1 e 2,0 "Конец"\nE s1 t1\nE t1 e1');
  assert.ok(codes(nounTask).includes('TASK_NAME'));
  const useless = B.parseDsl('N s1 s 0,0 "Начало"\nN a1 a 1,0\nN e1 e 2,0 "Конец"\nE s1 a1\nE a1 e1');
  assert.ok(codes(useless).includes('GATE_USELESS'));
  const startIn = B.parseDsl('N s1 s 0,0 "Начало"\nN t1 t 1,0 "Сделать работу"\nN e1 e 2,0 "Конец"\nE s1 t1\nE t1 e1\nE t1 s1');
  assert.ok(codes(startIn).includes('START_IN'));
});

test('анализ процесса: правильная схема завершается, ошибки слияния находятся', () => {
  const ok = B.analyze(B.parseDsl(dsl.ok));
  assert.ok(ok.completed && !ok.deadlock && ok.multi.length === 0);
  const m1 = B.analyze(B.parseDsl(dsl.andXor));
  assert.ok(m1.multi.length > 0, 'AND-ветвление с XOR-слиянием должно давать повторное выполнение');
  const dl = B.analyze(B.parseDsl(dsl.xorAnd));
  assert.ok(dl.deadlock && /зависнуть/.test(dl.deadlock.msg), 'XOR-ветвление с AND-слиянием должно давать зависание');
  assert.ok(codes(B.parseDsl(dsl.xorAnd)).includes('SIM_DEADLOCK'));
  assert.ok(codes(B.parseDsl(dsl.andXor)).includes('SIM_MULTI'));
});

test('анализ процесса: цикл, шлюз по событиям, граничные события и сообщения', () => {
  const loop = B.analyze(B.parseDsl(`N s1 s 0,0 "Начало"\nN x1 x 1,0\nN t1 t 2,0 "Проверить документ"\nN g1 x 3,0 "Есть замечания?"\nN t2 t 3,1 "Внести правки"\nN e1 e 4,0 "Готово"\nE s1 x1\nE x1 t1\nE t1 g1\nE g1 t2 "Да"\nE g1 e1 "Нет"\nE t2 x1`));
  assert.ok(loop.completed && !loop.deadlock && loop.multi.length === 0 && !loop.unbounded);
  const evb = B.analyze(B.parseDsl(`N s1 s 0,0 "Начало"\nN v1 v 1,0\nN i1 i:msg 2,0 "Ответ"\nN i2 i:timer 2,1 "Срок"\nN e1 e 3,0 "Принято"\nN e2 e 3,1 "Закрыто"\nE s1 v1\nE v1 i1\nE v1 i2\nE i1 e1\nE i2 e2`));
  assert.ok(evb.completed && !evb.deadlock, 'шлюз по событиям');
  const bnd = B.analyze(B.parseDsl(`N s1 s 0,0 "Начало"\nN t1 t 1,0 "Согласовать"\nB b1 t1 timer "Срок" ni\nN e1 e 2,0 "Готово"\nN t2 t 1,1 "Напомнить"\nN e2 e 2,1 "Напомнили"\nE s1 t1\nE t1 e1\nE b1 t2\nE t2 e2`));
  assert.ok(bnd.completed && !bnd.deadlock && bnd.multi.length === 0, 'непрерывающее граничное событие');
  const coll = B.parseDsl(`P Клиент!\nP Магазин\nN s1 s:msg 0,0 "Заказ получен"\nN t1 t:send 1,0 "Выставить счёт"\nN e1 e 2,0 "Готово"\nE s1 t1\nE t1 e1\nE p1 s1 msg "Заказ"\nE t1 p1 msg "Счёт"`);
  const ca = B.analyze(coll);
  assert.ok(ca.completed && !ca.deadlock, 'коллаборация с чёрным ящиком');
  const wait = B.parseDsl(`P Первый\nP Второй\nN s1 s 0,0 "Старт"\nN t1 t 1,0 "Работа"\nN e1 e 2,0 "Конец"\nE s1 t1\nE t1 e1\nN s2 s 0,0 "Старт"\nN t2 t:receive 1,0 "Ждать ответ"\nN e2 e 2,0 "Конец"\nE s2 t2\nE t2 e2\nE e1 t2 msg "Нет такого"`);
  assert.ok(B.analyze(wait).completed !== undefined);
});

test('игра токенов: ходы и их выполнение', () => {
  const m = B.parseDsl(dsl.ok);
  const S = B.setup(m);
  let st = B.simInit();
  let mv = B.moves(S, st);
  assert.equal(mv.length, 1);
  st = B.fire(S, st, mv[0]);
  assert.equal(Object.keys(st.tok).length, 1);
  mv = B.moves(S, st);
  st = B.fire(S, st, mv[0]);
  mv = B.moves(S, st);
  assert.equal(mv.length, 2, 'на исключающем шлюзе два варианта');
  st = B.fire(S, st, mv[0]);
  while ((mv = B.moves(S, st)).length) st = B.fire(S, st, mv[0]);
  assert.equal(Object.keys(st.tok).length, 0);
});

test('правила соединения: пулы, сообщения, события', () => {
  const m = B.parseDsl(`P А: Дорожка\nP Б: Дорожка\nN s1 s 0,0 "Старт"\nN t1 t 1,0 "Шаг"\nN t2 t 1,1 "Другой шаг"\nN e1 e 2,0 "Конец"\nN g1 x 3,0 "Выбор?"`);
  /* t2 лежит в пуле Б, остальные в пуле А */
  assert.ok(B.canConnect(m, 't1', 't2', 'seq'), 'поток последовательности не может пересекать пул');
  assert.equal(B.canConnect(m, 't1', 't2', 'msg'), '');
  assert.ok(B.canConnect(m, 's1', 't1', 'msg'), 'сообщение внутри одного пула запрещено');
  assert.ok(B.canConnect(m, 'e1', 't1', 'seq'), 'из конечного события нельзя');
  assert.ok(B.canConnect(m, 't1', 's1', 'seq'), 'в начальное событие нельзя');
  assert.ok(B.canConnect(m, 't1', 't1', 'seq'), 'на себя нельзя');
  assert.ok(B.canConnect(m, 'g1', 't2', 'msg'), 'шлюз не отправляет сообщения');
  assert.equal(B.canConnect(m, 's1', 't1', 'seq'), '');
  const r = B.addEdge(m, 's1', 't1', 'seq');
  assert.ok(r.edge);
  assert.ok(B.addEdge(m, 's1', 't1', 'seq').err, 'повторный поток');
});

test('операции редактора: добавление, удаление, пулы и дорожки сохраняют положение фигур', () => {
  const m = B.empty();
  const p = B.addPool(m, 'Компания');
  B.addLane(m, p.id, 'Продажи');
  const L0 = B.layout(m);
  assert.equal(L0.lanes.length, 2);
  const n1 = B.addNode(m, 'task', 'none', 200, L0.lanes[1].y + 60, 'Позвонить клиенту');
  assert.equal(B.laneOf(B.layout(m), n1).name, 'Продажи');
  B.setLaneHeight(m, L0.lanes[0].id, 260);
  assert.equal(B.laneOf(B.layout(m), n1).name, 'Продажи', 'после изменения высоты верхней дорожки фигура осталась в своей дорожке');
  const p2 = B.addPool(m, 'Клиент', true);
  assert.ok(p2.bb);
  const bnd = B.addBoundary(m, n1.id, 'error');
  assert.ok(bnd && bnd.host === n1.id);
  assert.equal(B.removeLane(m, L0.lanes[1].id), true);
  assert.ok(!B.nodeAt(m, n1.id), 'при удалении дорожки её фигуры удаляются');
  assert.ok(!B.nodeAt(m, bnd.id), 'и их граничные события');
  assert.ok(B.addPool(m, 'Лишний') !== undefined);
});

test('сохранение и загрузка: круговой обмен и защита от мусора', () => {
  const m = B.parseDsl(dsl.ok);
  const back = B.fromJson(B.toJson(m));
  assert.equal(back.nodes.length, m.nodes.length);
  assert.equal(back.edges.length, m.edges.length);
  assert.equal(B.fromJson('{{{'), null);
  assert.equal(B.fromJson('"строка"'), null);
  const bad = B.fromJson(JSON.stringify({ pools: 5, nodes: [{ id: '__proto__', t: 'task' }, { id: 'ok1', t: 'bomb' }, { id: 'n1', t: 'task', x: 'abc', y: 1e12, l: 'x'.repeat(1000) }, { id: 'n2', t: 'bnd', host: 'нет' }], edges: [{ id: 'e1', f: 'n1', to: 'n9' }, { id: 'e2', f: 'n1', to: 'n1' }] }));
  assert.equal(bad.nodes.length, 1);
  assert.equal(bad.nodes[0].l.length, B.LIM.label);
  assert.ok(bad.nodes[0].y <= 8000 && bad.nodes[0].x >= -500);
  assert.equal(bad.edges.length, 0);
  assert.equal(({}).polluted, undefined);
});

/* Простая проверка корректности XML: теги закрыты в нужном порядке, спецсимволы экранированы, идентификаторы уникальны. */
function checkXml(xml) {
  const stack = [], ids = new Set();
  const re = /<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  let last = 0, m;
  while ((m = re.exec(xml))) {
    const between = xml.slice(last, m.index);
    assert.ok(!/</.test(between) && !/&(?!(amp|lt|gt|quot|#\d+);)/.test(between), 'недопустимый текст: ' + between.slice(0, 40));
    last = re.lastIndex;
    if (m[1]) assert.equal(stack.pop(), m[1], 'неверный порядок закрытия ' + m[1]);
    else if (m[2]) {
      for (const a of m[3].matchAll(/\s([\w:.-]+)="([^"]*)"/g)) {
        assert.ok(!/[<&](?!(amp|lt|gt|quot|#\d+);)/.test(a[2]), 'атрибут ' + a[1]);
        if (a[1] === 'id') { assert.ok(!ids.has(a[2]), 'повторяющийся id ' + a[2]); ids.add(a[2]); }
      }
      if (!m[4]) stack.push(m[2]);
    }
  }
  assert.deepEqual(stack, []);
  return ids;
}
test('экспорт в BPMN 2.0 XML: корректен и содержит графическую часть для каждой фигуры', () => {
  for (const t of BPMN_TASKS) {
    const m = B.parseDsl(t.ref);
    const xml = B.toXml(m);
    const ids = checkXml(xml);
    for (const n of m.nodes) assert.ok(ids.has('Shape_' + n.id), t.id + ' нет фигуры ' + n.id);
    for (const e of m.edges) assert.ok(ids.has('Edge_' + e.id), t.id + ' нет линии ' + e.id);
    assert.ok(/<bpmn:definitions/.test(xml) && /<bpmndi:BPMNDiagram/.test(xml));
  }
  const xml = B.toXml(B.parseDsl(dsl.ok));
  for (const tag of ['bpmn:startEvent', 'bpmn:exclusiveGateway', 'bpmn:endEvent', 'bpmn:sequenceFlow']) assert.ok(xml.includes(tag), tag);
  const sp = B.parseDsl('N s1 s 0,0 "Имя & <тест> \\"кавычки\\""\nN t1 t:user 1,0 "Шаг"\nN e1 e 2,0 "Конец"\nE s1 t1\nE t1 e1');
  checkXml(B.toXml(sp));
  assert.ok(B.toXml(sp).includes('bpmn:userTask'));
});

test('рисунки для текста: fig и symbol возвращают разметку', () => {
  assert.ok(B.fig(dsl.ok, 'Подпись').includes('<figcaption>Подпись</figcaption>'));
  assert.ok(B.symbol('xor', '', '').includes('<svg'));
  assert.ok(B.iconSvg('task', 'user').includes('<svg'));
});
