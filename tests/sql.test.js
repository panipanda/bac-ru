'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCourse } = require('./load');

const { SQL, SQL_DB, SQL_TASKS } = loadCourse();
const run = q => SQL.run(SQL_DB, q);
const plain = x => JSON.parse(JSON.stringify(x));
const rows = q => plain(run(q).rows);

test('SQL: выборка, фильтры, сортировка, ограничение', () => {
  assert.deepEqual(rows("SELECT name FROM customers WHERE city = 'Рига' ORDER BY name"), [['Анна Орлова'], ['Вера Лунина'], ['Игорь Зимин']]);
  assert.equal(rows('SELECT * FROM orders LIMIT 5').length, 5);
  assert.deepEqual(rows("SELECT id FROM orders WHERE total BETWEEN 100 AND 135 ORDER BY id"), [[101], [111]]);
  assert.deepEqual(rows("SELECT name FROM customers WHERE name LIKE 'А%'"), [['Анна Орлова']]);
  assert.deepEqual(rows("SELECT id FROM orders WHERE status IN ('new', 'cancelled') AND total > 30 ORDER BY id"), [[104], [106]]);
  assert.deepEqual(rows('SELECT DISTINCT city FROM customers ORDER BY city').length, 4);
  assert.deepEqual(rows('SELECT name FROM customers ORDER BY registered DESC LIMIT 1'), [['Игорь Зимин']]);
});

test('SQL: агрегаты, группировка и HAVING', () => {
  assert.deepEqual(rows('SELECT COUNT(*) FROM orders'), [[12]]);
  assert.deepEqual(rows("SELECT SUM(total) FROM orders WHERE status = 'paid'"), [[754.9]]);
  assert.deepEqual(rows('SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY n DESC, status').slice(0, 2), [['paid', 6], ['shipped', 3]]);
  assert.deepEqual(rows('SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) >= 3 ORDER BY customer_id'), [[1], [3]]);
  assert.deepEqual(rows("SELECT MIN(total), MAX(total), COUNT(DISTINCT customer_id) FROM orders"), [[20, 210, 6]]);
  assert.deepEqual(rows('SELECT COUNT(*), SUM(total) FROM orders WHERE total > 1000'), [[0, null]], 'агрегат по пустому набору возвращает одну строку');
  assert.deepEqual(rows('SELECT ROUND(AVG(total), 1) FROM orders WHERE status = \'paid\''), [[125.8]]);
});

test('SQL: соединения INNER и LEFT', () => {
  assert.equal(rows('SELECT c.name, o.total FROM orders o JOIN customers c ON c.id = o.customer_id').length, 12);
  assert.deepEqual(rows('SELECT c.name FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL ORDER BY c.name'), [['Жанна Крылова'], ['Игорь Зимин']]);
  assert.equal(rows('SELECT c.name, o.id FROM customers c LEFT JOIN orders o ON o.customer_id = c.id').length, 14);
  assert.equal(rows('SELECT p.name FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id WHERE o.status = \'paid\'').length, 12);
});

test('SQL: NULL, арифметика и функции', () => {
  assert.deepEqual(rows('SELECT total * 2 AS twice FROM orders WHERE id = 101'), [[240]]);
  assert.deepEqual(rows("SELECT UPPER(city), LENGTH(name) FROM customers WHERE id = 2"), [['ТАЛЛИН', 9]]);
  assert.deepEqual(rows('SELECT COALESCE(NULL, 5)'.replace('SELECT COALESCE(NULL, 5)', 'SELECT COALESCE(NULL, 5) FROM customers LIMIT 1')), [[5]]);
  const dbn = { t: { cols: ['a'], rows: [[1], [null], [3]] } };
  assert.equal(SQL.run(dbn, 'SELECT * FROM t WHERE a = NULL').rows.length, 0);
  assert.equal(SQL.run(dbn, 'SELECT * FROM t WHERE a IS NULL').rows.length, 1);
  assert.equal(SQL.run(dbn, 'SELECT * FROM t WHERE a <> 1').rows.length, 1, 'сравнение с NULL даёт неизвестно');
  assert.deepEqual(plain(SQL.run(dbn, 'SELECT COUNT(*), COUNT(a) FROM t').rows), [[3, 2]]);
});

test('SQL: ошибки понятны и помечены', () => {
  const bad = {
    'SELEC 1': /SELECT/, 'SELECT x FROM customers': /Неизвестный столбец/, 'SELECT name FROM nothing': /Неизвестная таблица/,
    'SELECT name, COUNT(*) FROM customers': /GROUP BY/, 'SELECT * FROM customers WHERE COUNT(*) > 1': /HAVING/,
    'SELECT id FROM customers c JOIN orders o ON o.customer_id = c.id': /нескольких таблицах/, "SELECT * FROM customers WHERE name = 'x": /разобрать/,
    'SELECT FOO(1) FROM customers': /Неизвестная функция/, 'SELECT 1 / 0 FROM customers': /Деление на ноль/
  };
  for (const [q, re] of Object.entries(bad)) {
    try { run(q); assert.fail('нет ошибки: ' + q); } catch (e) { assert.ok(e.sql && re.test(e.message), q + ' -> ' + e.message); }
  }
});

test('SQL: сравнение результатов', () => {
  const a = run('SELECT name FROM customers ORDER BY name'), b = run('SELECT name FROM customers ORDER BY name DESC');
  assert.ok(SQL.same(a, b, false));
  assert.ok(!SQL.same(a, b, true));
  assert.match(SQL.diff(a, b, true), /порядок/);
  assert.match(SQL.diff(a, run('SELECT name, city FROM customers'), false), /столбцов/);
  assert.match(SQL.diff(a, run("SELECT name FROM customers WHERE city = 'Рига'"), false), /Строк/);
  assert.equal(SQL.diff(a, b, false), '');
});

test('задания SQL: эталоны выполняются, ожидаемые результаты стабильны и без неоднозначных ничьих', () => {
  for (const t of SQL_TASKS) {
    const r = run(t.solution);
    assert.ok(r.cols.length >= 1, t.id);
    if (t.free) continue;
    assert.ok(r.rows.length >= 1, t.id + ' пустой результат');
    assert.equal(SQL.diff(r, r, !!t.ordered), '', t.id);
  }
  const top = run('SELECT p.name, SUM(i.qty) AS sold FROM order_items i JOIN products p ON p.id = i.product_id GROUP BY p.name ORDER BY sold DESC');
  assert.ok(top.rows[0][1] > top.rows[1][1] && top.rows[1][1] > top.rows[2][1] && top.rows[2][1] > top.rows[3][1], 'в задании про топ-3 нет ничьих на границах');
  const s3 = run(SQL_TASKS.find(t => t.id === 's3').solution).rows.map(r => r[1]);
  assert.equal(new Set(s3).size, s3.length, 'в задании с сортировкой по сумме нет ничьих');
});

test('задания SQL: типичные неверные ответы не проходят проверку', () => {
  const s4 = SQL_TASKS.find(t => t.id === 's4');
  const want = run(s4.solution);
  assert.notEqual(SQL.diff(run('SELECT c.name FROM customers c JOIN orders o ON o.customer_id = c.id'), want, false), '', 'INNER JOIN вместо LEFT');
  const s5 = SQL_TASKS.find(t => t.id === 's5');
  assert.notEqual(SQL.diff(run('SELECT c.city, SUM(o.total) AS revenue FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.city HAVING SUM(o.total) > 100 ORDER BY revenue DESC'), run(s5.solution), true), '', 'без отбора по статусу');
});
