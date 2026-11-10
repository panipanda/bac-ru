'use strict';
/* Фабрики небольших тренажёров: сортировка по категориям, разбор дефектов, калькулятор RICE, редактор SQL.
   Данные самих тренажёров лежат в content/ru/trainers.js. Расчёты берутся из lib.js, этот файл только рисует и подключает интерфейс. */

/* Сортировка: у каждого пункта выпадающий список категорий. items: [[текст (можно HTML), номер категории, пояснение]] */
function makeSorter(name, cfg) {
  WIDGETS[name] = {
    title: cfg.title, tag: cfg.tag || 'сопоставление',
    init(b) {
      const ids = cfg.items.map(() => uid('srt'));
      b.innerHTML = (cfg.intro ? `<p class="src" style="margin-top:0">${cfg.intro}</p>` : '') +
        cfg.items.map((it, i) => `<div class="field" style="margin-bottom:10px"><label for="${ids[i]}">${i + 1}. ${it[0]}</label><select id="${ids[i]}"><option value="">${cfg.prompt || 'Выберите вариант'}</option>${cfg.cats.map((r, j) => `<option value="${j}">${r}</option>`).join('')}</select><div id="${ids[i]}-fb"></div></div>`).join('') +
        '<div class="row"><button class="btn" type="button" data-chk="1">Проверить</button><span class="score" data-score="1"></span></div>';
      $('[data-chk]', b).onclick = () => {
        let ok = 0;
        cfg.items.forEach((it, i) => {
          const v = $('#' + ids[i], b).value, good = v !== '' && +v === it[1];
          if (good) ok++;
          $('#' + ids[i] + '-fb', b).innerHTML = v === '' ? '' : `<div class="fb ${good ? 'ok' : 'bad'}">${good ? 'Верно. ' : 'Правильный ответ: ' + cfg.cats[it[1]] + '. '}${it[2]}</div>`;
        });
        $('[data-score]', b).textContent = `${ok} из ${cfg.items.length} верно`;
      };
    }
  };
}

/* Разбор дефектов: к каждому тексту нужно отметить все проблемы. items: [{ text, bad: [номера дефектов], why, fix }] */
function makeClinic(name, cfg) {
  WIDGETS[name] = {
    title: cfg.title, tag: cfg.tag || 'разбор',
    init(b) {
      const ids = cfg.items.map(() => uid('cl'));
      b.innerHTML = (cfg.intro ? `<p class="src" style="margin-top:0">${cfg.intro}</p>` : '') +
        cfg.items.map((it, i) => `<div class="q" style="margin:0 0 12px"><p class="qt">${i + 1}. «${it.text}»</p>${cfg.defects.map((d, j) => `<label class="chk"><input type="checkbox" data-i="${i}" data-j="${j}"><span>${d}</span></label>`).join('')}<div id="${ids[i]}"></div></div>`).join('') +
        '<div class="row"><button class="btn" type="button" data-chk="1">Проверить</button><span class="score" data-score="1"></span></div>';
      $('[data-chk]', b).onclick = () => {
        let ok = 0;
        cfg.items.forEach((it, i) => {
          const picked = $$(`input[data-i="${i}"]`, b).filter(x => x.checked).map(x => +x.dataset.j);
          const good = sameSet(picked, it.bad);
          if (good) ok++;
          $('#' + ids[i], b).innerHTML = `<div class="fb ${good ? 'ok' : 'bad'}"><b>${good ? 'Верно.' : 'Не совпало.'}</b> Проблемы: ${it.bad.length ? it.bad.map(j => cfg.defects[j]).join('; ') : 'нет, формулировка хорошая'}. ${it.why}${it.fix ? `<br><b>Как лучше:</b> «${it.fix}»` : ''}</div>`;
        });
        $('[data-score]', b).textContent = `${ok} из ${cfg.items.length} разобрано верно`;
      };
    }
  };
}

/* Калькулятор RICE для трёх идей. */
WIDGETS.rice = {
  title: 'Калькулятор RICE', tag: 'расчёт',
  init(b) {
    const rows = [['Умные подсказки в поиске', 8000, 0.5, 80, 3], ['Экспорт отчёта в Excel', 600, 2, 90, 1], ['Тёмная тема', 9000, 0.25, 100, 2]];
    const ids = rows.map(() => uid('rice'));
    b.innerHTML = `<p class="src" style="margin-top:0">Охват это число людей за период, влияние оценивается по шкале 0,25 / 0,5 / 1 / 2 / 3, уверенность в процентах, трудозатраты в человеко-месяцах. Измените числа и посмотрите, как меняется порядок.</p>
    <div class="tbl"><table><thead><tr><th>Идея</th><th>Охват</th><th>Влияние</th><th>Уверенность, %</th><th>Трудозатраты</th><th>RICE</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${r[0]}</td>${[1, 2, 3, 4].map(k => `<td><input type="text" inputmode="decimal" id="${ids[i]}-${k}" value="${String(r[k]).replace('.', ',')}" style="width:90px" aria-label="${r[0]}, поле ${k}"></td>`).join('')}<td class="num" id="${ids[i]}-s"></td></tr>`).join('')}</tbody></table></div>
    <div class="row"><button class="btn" type="button" data-calc="1">Рассчитать</button></div><div data-out="1"></div>`;
    const calc = () => {
      const res = rows.map((r, i) => {
        const v = [1, 2, 3, 4].map(k => parseNum($('#' + ids[i] + '-' + k, b).value));
        return { name: r[0], s: v.some(isNaN) ? NaN : riceScore(v[0], v[1], v[2], v[3]), i };
      });
      res.forEach(r => { $('#' + ids[r.i] + '-s', b).textContent = isNaN(r.s) ? 'ошибка ввода' : fmt(r.s, 0); });
      const ok = res.filter(r => !isNaN(r.s)).sort((x, y) => y.s - x.s), max = ok.length ? ok[0].s : 1;
      $('[data-out]', b).innerHTML = ok.length ? `<div class="bars" style="margin-top:10px">${ok.map(r => `<span>${r.name}</span><span><div class="bar" style="width:${Math.max(3, r.s / max * 100)}%"></div></span><span class="num">${fmt(r.s, 0)}</span>`).join('')}</div><p class="src">Первым в очереди стоит «${ok[0].name}». RICE помогает спорить о приоритетах числами, но оценки остаются мнением людей: проверяйте охват и уверенность, а не только формулу.</p>` : '<div class="fb info">Введите числа. Подойдёт и точка, и запятая.</div>';
    };
    $('[data-calc]', b).onclick = calc;
    calc();
  }
};

/* ===== SQL-практикум ===== */
function sqlTable(res) {
  if (!res.rows.length) return '<div class="fb info">Запрос выполнен, строк нет.</div>';
  return `<div class="rs tbl"><table><thead><tr>${res.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${res.rows.slice(0, 200).map(r => `<tr>${r.map(v => `<td>${esc(SQL.fmtVal(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="src">Строк: ${res.rows.length}.</p>`;
}
function mountSql(box, task, io) {
  const id = uid('sql');
  const want = task.free ? null : SQL.run(SQL_DB, task.solution);
  const tablesHtml = Object.keys(SQL_DB).map(n => `<h4 style="margin:12px 0 4px">${n}</h4>${sqlTable({ cols: SQL_DB[n].cols, rows: SQL_DB[n].rows }).replace(/<p class="src">.*?<\/p>/, '')}`).join('');
  box.innerHTML = `<div class="prose"><p style="margin-top:0">${task.brief}</p></div>
  <details><summary>Таблицы и данные</summary><div class="prose"><p>${SQL_NOTE}</p></div>${tablesHtml}</details>
  <div class="field"><label for="${id}">Запрос SQL (Ctrl+Enter выполняет)</label><textarea class="sqlbox" id="${id}" spellcheck="false" autocomplete="off" maxlength="${LIMITS.query}" placeholder="SELECT ..."></textarea></div>
  <div class="row" style="margin-top:8px"><button class="btn" type="button" data-a="run">Выполнить</button>${task.free ? '' : '<button class="btn ghost" type="button" data-a="check">Проверить ответ</button><button class="btn ghost" type="button" data-a="hint">Подсказка</button><button class="btn ghost" type="button" data-a="sol">Показать решение</button>'}</div>
  <div data-out="1"></div>`;
  const ta = $('textarea', box), out = $('[data-out]', box);
  ta.value = io.load() || '';
  let hintN = 0, tm = null;
  ta.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => io.save(ta.value, false), 700); });
  const exec = () => {
    try { return { res: SQL.run(SQL_DB, ta.value) }; } catch (e) {
      out.innerHTML = `<div class="fb bad"><b>Ошибка.</b> ${esc(e.sql ? e.message : 'Запрос не удалось выполнить.')}</div>`;
      return null;
    }
  };
  box.addEventListener('click', ev => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'run') { const r = exec(); if (r) out.innerHTML = sqlTable(r.res); }
    else if (a.dataset.a === 'check') {
      const r = exec(); if (!r) return;
      const d = SQL.diff(r.res, want, task.ordered);
      out.innerHTML = (d ? `<div class="fb bad"><b>Пока не то.</b> ${d}</div>` : '<div class="fb ok"><b>Верно.</b> Результат совпал с ожидаемым. Сравните своё решение с эталонным: запросов бывает несколько.</div>') + sqlTable(r.res);
      if (!d) io.save(ta.value, true);
    } else if (a.dataset.a === 'hint') {
      const h = task.hints || [];
      out.innerHTML = h.length ? `<div class="fb info"><b>Подсказка ${Math.min(hintN + 1, h.length)} из ${h.length}.</b> ${h[Math.min(hintN, h.length - 1)]}</div>` : '<div class="fb info">Для этого задания подсказок нет.</div>';
      hintN++;
    } else if (a.dataset.a === 'sol') {
      out.innerHTML = `<div class="callout"><b>Эталонное решение</b>Один из вариантов: <pre class="mono-box">${esc(task.solution)}</pre></div>`;
    }
  });
  ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); const r = exec(); if (r) out.innerHTML = sqlTable(r.res); } });
}
function registerSqlLabs() {
  SQL_TASKS.forEach(t => {
    WIDGETS['sql-' + t.id] = {
      title: t.free ? 'Песочница SQL' : 'Задача SQL: ' + t.title, tag: t.free ? 'запросы' : 'SQL',
      init(b) {
        mountSql(b, t, {
          load: () => (state.sql[t.id] || {}).q || '',
          save: (q, ok) => { const o = state.sql[t.id] || {}; state.sql[t.id] = { ok: (ok || o.ok) ? 1 : 0, ts: Date.now(), q: q.slice(0, LIMITS.query) }; touch(); if (ok) renderChrome(); }
        });
      }
    };
  });
}
