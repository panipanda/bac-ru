/* Учебная база интернет-магазина и задания по SQL. Данные вымышленные.
   Ожидаемый результат каждого задания считается при запуске по эталонному запросу. */

const SQL_DB = {
  customers: { cols: ['id', 'name', 'city', 'registered'], rows: [
    [1, 'Анна Орлова', 'Рига', '2024-01-15'], [2, 'Борис Ким', 'Таллин', '2024-02-03'], [3, 'Вера Лунина', 'Рига', '2024-02-20'],
    [4, 'Георгий Седов', 'Тбилиси', '2024-03-11'], [5, 'Дарья Мельник', 'Ереван', '2024-04-02'], [6, 'Егор Лавров', 'Таллин', '2024-05-19'],
    [7, 'Жанна Крылова', 'Тбилиси', '2024-06-01'], [8, 'Игорь Зимин', 'Рига', '2024-06-30']
  ] },
  orders: { cols: ['id', 'customer_id', 'created', 'status', 'total'], rows: [
    [101, 1, '2024-07-01', 'paid', 120], [102, 1, '2024-07-15', 'shipped', 80.5], [103, 2, '2024-07-03', 'paid', 45], [104, 3, '2024-07-04', 'cancelled', 60],
    [105, 3, '2024-08-02', 'paid', 210], [106, 4, '2024-08-05', 'new', 35], [107, 5, '2024-08-07', 'paid', 99.9], [108, 1, '2024-08-09', 'paid', 150],
    [109, 2, '2024-08-11', 'shipped', 72], [110, 6, '2024-08-12', 'cancelled', 20], [111, 5, '2024-08-20', 'paid', 130], [112, 3, '2024-09-01', 'shipped', 55]
  ] },
  products: { cols: ['id', 'name', 'category', 'price'], rows: [
    [1, 'Блокнот', 'Канцелярия', 5], [2, 'Ручка', 'Канцелярия', 2.5], [3, 'Рюкзак', 'Аксессуары', 40],
    [4, 'Кружка', 'Дом', 12], [5, 'Лампа', 'Дом', 30], [6, 'Чехол', 'Аксессуары', 15]
  ] },
  order_items: { cols: ['order_id', 'product_id', 'qty'], rows: [
    [101, 3, 1], [101, 1, 4], [102, 5, 2], [103, 2, 6], [105, 3, 2], [105, 4, 3], [105, 6, 2], [106, 2, 2],
    [107, 4, 2], [107, 1, 3], [108, 5, 1], [108, 6, 4], [109, 1, 6], [111, 3, 2], [111, 6, 3], [112, 2, 4]
  ] }
};
const SQL_NOTE = 'Таблицы: <code>customers</code> (клиенты), <code>orders</code> (заказы; status: new, paid, shipped, cancelled), <code>products</code> (товары), <code>order_items</code> (строки заказов: заказ, товар, количество). Связи: <code>orders.customer_id</code> ссылается на <code>customers.id</code>, <code>order_items.order_id</code> на <code>orders.id</code>, <code>order_items.product_id</code> на <code>products.id</code>.';

SQL_TASKS.push(
  { id: 's1', mod: 'm12', title: 'Клиенты из Риги', ordered: true,
    brief: 'Выведите имена и даты регистрации клиентов из Риги, от самой ранней регистрации к самой поздней.',
    solution: "SELECT name, registered FROM customers WHERE city = 'Рига' ORDER BY registered",
    hints: ['Фильтр по строке: WHERE city = \'Рига\'. Текст берётся в одинарные кавычки.', 'Сортировка: ORDER BY registered (по возрастанию по умолчанию).'] },
  { id: 's2', mod: 'm12', title: 'Заказы по статусам', ordered: false,
    brief: 'Посчитайте число заказов в каждом статусе. Нужны два столбца: статус и количество.',
    solution: 'SELECT status, COUNT(*) AS n FROM orders GROUP BY status',
    hints: ['Группировка: GROUP BY status.', 'Количество строк в группе считает COUNT(*).'] },
  { id: 's3', mod: 'm12', title: 'Оплаченные заказы с именами', ordered: true,
    brief: 'Покажите имя клиента и сумму для каждого заказа со статусом paid. Самые крупные заказы сверху.',
    solution: "SELECT c.name, o.total FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status = 'paid' ORDER BY o.total DESC",
    hints: ['Имя лежит в customers, сумма в orders: нужен JOIN по customers.id = orders.customer_id.', 'Сортировка по убыванию: ORDER BY o.total DESC.'] },
  { id: 's4', mod: 'm12', title: 'Клиенты без заказов', ordered: false,
    brief: 'Найдите клиентов, у которых нет ни одного заказа. Выведите только имя.',
    solution: 'SELECT c.name FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL',
    hints: ['Обычный JOIN отбросит клиентов без заказов. Нужен LEFT JOIN.', 'У клиента без заказов правая часть пустая: условие o.id IS NULL.'] },
  { id: 's5', mod: 'm12', title: 'Выручка по городам', ordered: true,
    brief: 'Посчитайте сумму заказов по городам клиентов. Учитывайте только заказы со статусами paid и shipped и показывайте только города, где сумма больше 100. Сначала самые большие суммы.',
    solution: "SELECT c.city, SUM(o.total) AS revenue FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.status IN ('paid', 'shipped') GROUP BY c.city HAVING SUM(o.total) > 100 ORDER BY revenue DESC",
    hints: ['Условие по статусу идёт в WHERE, потому что оно относится к строкам.', 'Условие по сумме города идёт в HAVING, потому что оно относится к группе.', 'WHERE выполняется до группировки, HAVING после.'] },
  { id: 's6', mod: 'm12', title: 'Три самых продаваемых товара', ordered: true,
    brief: 'Выведите названия трёх товаров с наибольшим суммарным количеством проданных штук и это количество.',
    solution: 'SELECT p.name, SUM(i.qty) AS sold FROM order_items i JOIN products p ON p.id = i.product_id GROUP BY p.name ORDER BY sold DESC LIMIT 3',
    hints: ['Количество лежит в order_items, название в products.', 'Суммируем qty по каждому товару и сортируем по убыванию.', 'LIMIT 3 оставляет три первые строки.'] },
  { id: 's7', mod: 'm12', title: 'Постоянные клиенты', ordered: false,
    brief: 'Найдите клиентов с двумя и более заказами (любого статуса). Выведите имя, число заказов и средний чек, округлённый до двух знаков.',
    solution: 'SELECT c.name, COUNT(*) AS orders_n, ROUND(AVG(o.total), 2) AS avg_total FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name HAVING COUNT(*) >= 2',
    hints: ['Группируйте по клиенту, считайте COUNT(*) и AVG(o.total).', 'Отбор групп по числу заказов делает HAVING COUNT(*) >= 2.', 'Округление: ROUND(значение, 2).'] },
  { id: 'sfree', mod: 'm12', title: 'Свободная песочница', free: true,
    brief: 'Здесь можно выполнять любые запросы SELECT к учебной базе, чтобы изучить таблицы и проверить свои догадки.',
    solution: 'SELECT * FROM customers' }
);
