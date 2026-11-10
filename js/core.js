'use strict';
/* Ядро приложения: состояние, навигация, вопросы, практика, карточки, экзамен, глоссарий.
   Текст курса приходит из content/ru/*.js, тренажёры из widgets.js и bpmn-lab.js, чистая логика из lib.js. */

const COURSE = [], WIDGETS = {}, CARDS = [], GLOSS = [], SOURCES = {}, BPMN_TASKS = [], SQL_TASKS = [];
const PARTS = [
  { id: 'a', title: 'Часть 1. Профессия и требования' },
  { id: 'b', title: 'Часть 2. Процессы и BPMN' },
  { id: 'c', title: 'Часть 3. Модели, данные, интеграции' },
  { id: 'd', title: 'Часть 4. Разработка и карьера' }
];
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
let UID = 0; const uid = p => p + '-' + (++UID);
const SITE_TITLE = 'Бизнес-анализ: курс с практикумом по BPMN';
/* Короткие имена для текста модулей: схема BPMN по краткой записи и символ отдельного элемента. */
const D = (dsl, cap, o) => BPMN.fig(dsl, cap, o);
const SYM = (t, k, label) => BPMN.symbol(t, k, label);
/* Сетка символов с подписями: [[тип, вид, название, пояснение]] */
const SYMS = items => '<div class="sym-grid">' + items.map(([t, k, name, cap]) => `<div class="sym">${SYM(t, k, '')}<b>${name}</b>${cap ? `<br><span class="src">${cap}</span>` : ''}</div>`).join('') + '</div>';

/* ===== состояние и сохранение (только в браузере посетителя) ===== */
let state = fresh();
const store = { mode: 'none' };
let persistAsked = false;
function storageOk() { try { const k = LS_KEY + '.probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } }
function loadLocal() { try { const s = localStorage.getItem(LS_KEY); if (s) return sanitizeState(JSON.parse(s)); } catch (e) { /* хранилище недоступно */ } return null; }
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; } catch (e) { return false; } }
function askPersist() {
  if (persistAsked) return; persistAsked = true;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* не страшно */ }
}
function touch() { state.ts = Date.now(); store.mode = saveLocal() ? 'browser' : 'none'; paintStatus(); askPersist(); }
function paintStatus() {
  const s = $('#save-state'); if (s) s.textContent = store.mode === 'browser' ? 'Сохранено в этом браузере' : 'Прогресс не сохраняется';
  const h = $('#home-save'); if (h) h.textContent = store.mode === 'browser' ? 'хранится только в этом браузере' : 'не сохраняется (браузер блокирует хранилище сайта), используйте экспорт';
}
function initStore() {
  const local = loadLocal();
  if (local) state = local;
  store.mode = storageOk() ? 'browser' : 'none';
  paintStatus();
}

/* ===== экспорт и импорт прогресса ===== */
function exportProgress() {
  const blob = new Blob([serializeState(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'progress.json'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importProgress(file, msgEl) {
  const say = (t, ok) => { msgEl.className = 'fb ' + (ok ? 'ok' : 'bad'); msgEl.textContent = t; };
  if (!file) return;
  if (file.size > LIMITS.file) { say('Файл слишком большой.', false); return; }
  let text; try { text = await file.text(); } catch (e) { say('Не удалось прочитать файл.', false); return; }
  const r = parseImport(text);
  if (!r.ok) { say(r.error, false); return; }
  state = mergeStates(state, r.state); touch(); renderChrome();
  say('Прогресс загружен и объединён с тем, что уже есть в браузере.', true);
  setTimeout(() => { if (currentRoute() === 'home') route(); }, 1200);
}

/* ===== навигация ===== */
const view = () => $('#view');
const currentRoute = () => (location.hash || '#home').slice(1) || 'home';
const moduleIds = () => COURSE.map(m => m.id);
const labTasks = () => BPMN_TASKS.filter(t => !t.free);
const labsDone = () => labTasks().filter(t => state.lab[t.id] && state.lab[t.id].ok).length;
const sqlDone = () => SQL_TASKS.filter(t => state.sql[t.id] && state.sql[t.id].ok).length;
function pct() { const n = COURSE.length; return n ? Math.round(doneCount(state, moduleIds()) / n * 100) : 0; }
function renderChrome() {
  const nav = $('#nav'); if (!nav) return;
  const r = currentRoute();
  const item = (href, n, t, st, ok) => `<a href="#${href}" ${r === href ? 'aria-current="page"' : ''}><span class="n">${n}</span><span>${t}</span><span class="st ${ok ? 'ok' : ''}">${st}</span></a>`;
  let h = `<h4>Начало</h4>${item('home', '·', 'О курсе', '', '')}`;
  PARTS.forEach(p => {
    const mods = COURSE.filter(m => m.part === p.id);
    if (!mods.length) return;
    h += `<h4>${p.title}</h4>` + mods.map(m => {
      const i = COURSE.indexOf(m), q = state.quiz[m.id], ok = !!state.done[m.id];
      return item(m.id, String(i + 1).padStart(2, '0'), esc(m.short || m.title), ok ? '✓' : (q ? q.best + '/' + q.total : ''), ok);
    }).join('');
  });
  h += `<h4>Практика</h4>${item('lab', 'B', 'Задания по BPMN', labTasks().length ? labsDone() + '/' + labTasks().length : '', labsDone() === labTasks().length && labTasks().length > 0)}`;
  h += `${item('exam', 'Э', 'Итоговый экзамен', state.quiz.exam ? state.quiz.exam.best + '/' + state.quiz.exam.total : '', '')}${item('cards', 'К', 'Карточки для собеседования', cardStat(), '')}${item('glossary', 'Г', 'Глоссарий', '', '')}`;
  nav.innerHTML = h;
  const p = pct(); $('#meter-fill').style.width = p + '%'; $('#meter-txt').textContent = p + '% курса';
}
function cardStat() { const k = CARDS.filter(c => state.cards[c.id] && state.cards[c.id].k === 1).length; return k ? k + '/' + CARDS.length : ''; }
function route() {
  const r = currentRoute(); const v = view(); $('#nav').classList.remove('open');
  document.title = SITE_TITLE;
  if (r === 'home') renderHome(v);
  else if (r === 'exam') renderExam(v);
  else if (r === 'cards') renderCards(v);
  else if (r === 'glossary') renderGlossary(v);
  else if (r === 'lab') renderLabs(v);
  else { const i = COURSE.findIndex(m => m.id === r); if (i >= 0) renderModule(v, COURSE[i], i); else renderHome(v); }
  renderChrome(); window.scrollTo(0, 0);
}

/* ===== страница модуля ===== */
function sourcesBlock(id) {
  const list = SOURCES[id]; if (!list || !list.length) return '';
  return `<div class="sources"><h3>Источники</h3><ul>${list.map(s => `<li><a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a></li>`).join('')}</ul></div>`;
}
function renderModule(v, m, idx) {
  const body = m.body.replace(/\{\{w:([\w-]+)\}\}/g, (_, n) => `<div class="widget" data-w="${n}"></div>`);
  const prev = COURSE[idx - 1], next = COURSE[idx + 1];
  const isDone = !!state.done[m.id];
  document.title = m.title + ' | ' + SITE_TITLE;
  if (state.last !== m.id) { state.last = m.id; touch(); }
  v.innerHTML = `<article class="sheet">
  <div class="eyebrow">Модуль ${idx + 1} из ${COURSE.length} · около ${m.minutes} мин</div>
  <h1 style="font-size:1.8rem;margin:.3rem 0">${m.title}</h1><p class="lead">${m.lead}</p>
  <div class="learn"><b>После модуля вы сможете</b><ul>${m.learn.map(x => `<li>${x}</li>`).join('')}</ul></div>
  <div class="prose">${body}</div>
  <div class="take"><h3>Главное</h3><ul>${m.takeaways.map(x => `<li>${x}</li>`).join('')}</ul></div>
  <div class="quiz"><h2 style="margin-top:.4rem">Проверьте себя</h2><p class="src">Варианты ответа перемешиваются при каждом открытии. Разбор появляется сразу после ответа, а ваши ответы хранятся в этом браузере, поэтому можно уйти и вернуться.</p><div id="quiz-box"></div></div>
  <div class="practice" id="practice-box"></div>
  ${sourcesBlock(m.id)}
  <div class="row" style="margin-top:22px;justify-content:space-between">
    <div class="row">${prev ? `<a class="btn ghost" style="text-decoration:none" href="#${prev.id}">← ${esc(prev.short || prev.title)}</a>` : ''}</div>
    <div class="row"><button class="btn ${isDone ? 'ghost' : ''}" id="done-btn">${isDone ? 'Модуль пройден ✓ (отменить)' : 'Отметить модуль пройденным'}</button>${next ? `<a class="btn ghost" style="text-decoration:none" href="#${next.id}">${esc(next.short || next.title)} →</a>` : ''}</div>
  </div>
  ${isDone ? '<p class="src" style="text-align:right">Сохраните резервную копию прогресса. <button class="btn ghost sm" id="export-hint">Экспорт прогресса</button></p>' : ''}</article>`;
  $$('.widget', v).forEach(w => {
    const def = WIDGETS[w.dataset.w]; if (!def) { w.remove(); return; }
    w.innerHTML = `<div class="w-head"><span>${def.title}</span><span>${def.tag || 'тренажёр'}</span></div><div class="w-body"></div>`;
    def.init($('.w-body', w));
  });
  mountQuiz($('#quiz-box'), m.quiz, { id: m.id, persist: true, onFinish: (c, t) => { recordQuiz(m.id, c, t); } });
  mountPractice($('#practice-box'), m.practice);
  $('#done-btn').onclick = () => { if (state.done[m.id]) delete state.done[m.id]; else state.done[m.id] = true; touch(); renderModule(v, m, idx); renderChrome(); };
  const eh = $('#export-hint'); if (eh) eh.onclick = exportProgress;
}
function recordQuiz(id, c, t) { const o = state.quiz[id]; if (!o || c >= o.best) { state.quiz[id] = { best: c, total: t, last: c }; } else { o.last = c; } touch(); renderChrome(); }

/* ===== вопросы (ответы на вопросы модуля хранятся по каждому вопросу) ===== */
function feedback(q, ok, restored) {
  const t = q.type || 'mc';
  const head = ok ? 'Верно.' : (t === 'order' ? 'Порядок другой.' : 'Неверно.');
  const note = restored ? ` <span class="src">(раньше ответ был ${ok ? 'верным' : 'неверным'})</span>` : '';
  let extra = '';
  if (t === 'num') extra = ` Ответ: <span class="num">${fmt(q.ans, q.dec == null ? 2 : q.dec)}</span>.`;
  if (t === 'order') extra = ` Правильная последовательность: ${q.items.map((x, i) => `${i + 1}) ${x}`).join('; ')}.`;
  if (t === 'multi') extra = ` Верные варианты: ${q.a.map(i => q.o[i]).join('; ')}.`;
  return `<div class="fb ${ok ? 'ok' : 'bad'}"><b>${head}</b>${note}${extra} ${q.why}</div>`;
}
function mountQuiz(box, qs, cfg) {
  const key = cfg.persist ? cfg.id : null;
  let saved = key ? state.qprog[key] : null;
  if (saved && saved.length !== qs.length) saved = null;
  const res = qs.map((_, i) => saved ? (saved[i] === 'c' ? true : saved[i] === 'w' ? false : null) : null);
  box.innerHTML = '';
  const saveQuiz = () => { state.qprog[key] = res.map(r => r === true ? 'c' : r === false ? 'w' : '-').join(''); touch(); };
  qs.forEach((q, qi) => {
    const card = document.createElement('div'); card.className = 'q'; box.appendChild(card);
    renderQ(card, q, res[qi], ok => { res[qi] = ok; if (key) saveQuiz(); update(true); });
  });
  const foot = document.createElement('div'); foot.className = 'row'; foot.style.marginTop = '12px'; box.appendChild(foot);
  foot.addEventListener('click', e => {
    if (e.target.dataset.act !== 'reset') return;
    if (key) { delete state.qprog[key]; touch(); }
    mountQuiz(box, qs, cfg);
  });
  function update(live) {
    const done = res.filter(x => x !== null).length, c = res.filter(x => x === true).length;
    let h = `<span class="score">Отвечено ${done} из ${qs.length}, верно ${c}</span>`;
    if (done === qs.length) h += ` <span class="pill ${c / qs.length >= 0.7 ? 'ok' : 'hold'}">${Math.round(c / qs.length * 100)}%</span>`;
    if (key ? done > 0 : done === qs.length) h += ` <button class="btn ghost" data-act="reset">${key ? 'Сбросить ответы' : 'Ещё раз'}</button>`;
    foot.innerHTML = h;
    if (live && done === qs.length && cfg.onFinish) cfg.onFinish(c, qs.length, res);
  }
  update(false);
}
function renderQ(card, q, prior, cb) {
  const t = q.type || 'mc';
  if (prior !== null) {
    const opts = (t === 'mc' || t === 'multi') ? q.o.map((o, i) => `<button class="opt ${(t === 'mc' ? i === q.a : q.a.includes(i)) ? 'right' : ''}" disabled>${o}</button>`).join('') : '';
    card.innerHTML = `<p class="qt">${q.q}</p>${opts}<div class="slot">${feedback(q, prior, true)}</div>`;
    return;
  }
  if (t === 'mc') {
    const order = shuffle(q.o.map((_, i) => i));
    card.innerHTML = `<p class="qt">${q.q}</p>` + order.map(i => `<button class="opt" data-i="${i}">${q.o[i]}</button>`).join('') + '<div class="slot"></div>';
    card.addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b || b.disabled) return;
      const ok = +b.dataset.i === q.a;
      $$('.opt', card).forEach(x => { x.disabled = true; if (+x.dataset.i === q.a) x.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
      $('.slot', card).innerHTML = feedback(q, ok, false); cb(ok);
    });
  } else if (t === 'multi') {
    const order = shuffle(q.o.map((_, i) => i));
    card.innerHTML = `<p class="qt">${q.q} <span class="src">(несколько верных ответов)</span></p>` + order.map(i => `<label class="chk"><input type="checkbox" data-i="${i}"><span>${q.o[i]}</span></label>`).join('') + '<div class="row"><button class="btn">Проверить</button></div><div class="slot"></div>';
    const btn = $('button', card);
    btn.onclick = () => {
      const picked = $$('input', card).filter(x => x.checked).map(x => +x.dataset.i);
      if (!picked.length) { $('.slot', card).innerHTML = '<div class="fb info">Отметьте хотя бы один вариант.</div>'; return; }
      const ok = sameSet(picked, q.a);
      $$('input', card).forEach(x => { x.disabled = true; });
      btn.disabled = true;
      $$('.chk', card).forEach(l => { const i = +$('input', l).dataset.i; if (q.a.includes(i)) l.style.fontWeight = '600'; });
      $('.slot', card).innerHTML = feedback(q, ok, false); cb(ok);
    };
  } else if (t === 'num') {
    const id = uid('num');
    card.innerHTML = `<p class="qt">${q.q}</p><div class="row"><input type="text" inputmode="decimal" id="${id}" style="max-width:170px" aria-label="Ответ"><button class="btn">Проверить</button></div><div class="slot"></div>`;
    const btn = $('button', card), inp = $('input', card); let fin = false;
    const submit = () => {
      if (fin) return; const v = parseNum(inp.value); if (isNaN(v)) { $('.slot', card).innerHTML = '<div class="fb info">Введите число. Подойдёт и точка, и запятая.</div>'; return; }
      const ok = Math.abs(v - q.ans) <= (q.tol || 0.005); fin = true; inp.disabled = true; btn.disabled = true;
      $('.slot', card).innerHTML = feedback(q, ok, false); cb(ok);
    };
    btn.onclick = submit;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  } else if (t === 'order') {
    const idx = shuffle(q.items.map((_, i) => i)); let picked = [], fin = false;
    const draw = () => {
      card.innerHTML = `<p class="qt">${q.q}</p><div class="chips">${idx.map(i => `<button class="chip ${picked.includes(i) ? 'used' : ''}" data-i="${i}" ${picked.includes(i) || fin ? 'disabled' : ''}>${q.items[i]}</button>`).join('')}</div>
      <ol class="seq">${picked.map(i => `<li>${q.items[i]}</li>`).join('')}</ol>
      <div class="row">${fin ? '' : '<button class="btn ghost" data-r="1">Очистить выбор</button>'}</div><div class="slot"></div>`;
    };
    draw();
    card.addEventListener('click', e => {
      if (fin) return;
      if (e.target.dataset.r) { picked = []; draw(); return; }
      const b = e.target.closest('.chip'); if (!b || b.disabled) return; picked.push(+b.dataset.i);
      if (picked.length === q.items.length) {
        fin = true; const ok = picked.every((v, k) => v === k); draw();
        $('.slot', card).innerHTML = feedback(q, ok, false); cb(ok);
      } else draw();
    });
  }
}

/* ===== практика ===== */
function mountPractice(box, p) {
  const note = state.notes[p.id] || {}; const chk = (state.notes[p.id + ':c'] || {}).t || '';
  box.innerHTML = `<h3>Практика: ${p.title}</h3><div class="prose">${p.brief}</div>
  <div class="field" style="margin-top:10px"><label for="n-${p.id}">Ваш ответ (${store.mode === 'browser' ? 'сохраняется в этом браузере' : 'не сохраняется, хранилище недоступно'})</label><textarea id="n-${p.id}" data-note="${p.id}" maxlength="${LIMITS.note}" placeholder="Пишите здесь">${esc(note.t || p.template || '')}</textarea></div>
  <p class="src">Не вводите здесь ничего конфиденциального: данные работодателя, персональные данные, коммерческую тайну.</p>
  <h3 style="font-size:.95rem">Самопроверка</h3>${p.checks.map((c, i) => `<label class="chk"><input type="checkbox" data-c="${i}" ${chk[i] === '1' ? 'checked' : ''}><span>${c}</span></label>`).join('')}
  <details><summary>Показать образец ответа</summary><div class="prose">${p.model}</div></details>`;
  const ta = $('textarea', box); let tm = null;
  ta.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { state.notes[p.id] = { t: ta.value, ts: Date.now() }; touch(); }, 700); });
  box.addEventListener('change', e => { if (e.target.dataset.c === undefined) return; const bits = $$('input[data-c]', box).map(x => x.checked ? '1' : '0').join(''); state.notes[p.id + ':c'] = { t: bits, ts: Date.now() }; touch(); });
}

/* ===== главная ===== */
function continueTarget() {
  const lastIdx = COURSE.findIndex(m => m.id === state.last);
  if (lastIdx >= 0 && !state.done[COURSE[lastIdx].id]) return COURSE[lastIdx];
  const after = COURSE.slice(lastIdx + 1).find(m => !state.done[m.id]);
  return after || COURSE.find(m => !state.done[m.id]) || COURSE[0];
}
function renderHome(v) {
  const first = continueTarget();
  const doneN = doneCount(state, moduleIds());
  const started = doneN > 0 || !!state.last || Object.keys(state.qprog).length > 0;
  const verb = doneN === COURSE.length ? 'Повторить: ' : started ? 'Продолжить: ' : 'Начать: ';
  const mins = COURSE.reduce((a, m) => a + m.minutes, 0);
  const tile = (m, i) => `<a class="tile" href="#${m.id}"><span class="eyebrow">${String(i + 1).padStart(2, '0')} · ${m.minutes} мин</span><b>${m.title}</b><small>${state.done[m.id] ? 'Пройден ✓' : (state.quiz[m.id] ? 'Вопросы: ' + state.quiz[m.id].best + '/' + state.quiz[m.id].total : 'Не начат')}</small></a>`;
  v.innerHTML = `<article class="sheet">
  <div class="eyebrow">Курс для начинающих и переходящих в профессию · бесплатно · без регистрации</div>
  <h1 style="font-size:2.1rem;margin:.4rem 0">Бизнес-анализ от основ до собеседования</h1>
  <p class="lead">${COURSE.length} модулей: роль и требования, интервью и приоритизация, четыре модуля по BPMN с редактором схем прямо в браузере, UML, пользовательские истории, SQL, API, Agile и подготовка к собеседованию. В каждом модуле объяснение, вопросы с разбором и практическое задание.</p>
  <div class="row"><a class="btn" style="text-decoration:none" href="#${first.id}">${verb}${esc(first.short || first.title)}</a><span class="src">Пройдено ${doneN} из ${COURSE.length} · заданий BPMN ${labsDone()} из ${labTasks().length} · около ${Math.round(mins / 60)} ч чтения и практики</span></div>
  <h2>С чего начать</h2>
  <div class="dayplan">
   <b>Весь курс</b><span>Модули по порядку, с первого по пятнадцатый. Так материал выстроен от простого к сложному.</span>
   <b>Только BPMN</b><span>Модули 6-9 и страница «Задания по BPMN». Сначала прочитайте модуль 6, остальное можно делать на практике.</span>
   <b>К собеседованию</b><span>Модули 1, 4, 5, 6, 11, 12, 13, 14, затем итоговый экзамен и карточки с вопросами.</span>
  </div>
  <p class="src">Порядок модулей в оглавлении логичный, но не обязательный: каждый модуль объясняет свои термины.</p>
  ${PARTS.map(p => { const mods = COURSE.filter(m => m.part === p.id); return mods.length ? `<h2>${p.title}</h2><div class="grid">${mods.map(m => tile(m, COURSE.indexOf(m))).join('')}</div>` : ''; }).join('')}
  <div class="callout warn"><b>Как относиться к фактам</b>Курс учебный, а не справочник. Стандарты, названия ролей и практики в компаниях отличаются, инструменты меняются. Числа и сроки в примерах условные. Ссылки на источники в конце модулей ведут к первоисточникам: сверяйтесь с ними. Курс не связан с OMG, IIBA, PMI, Atlassian и другими организациями, чьи названия упоминаются для описания практик.</div>
  <h2>Ваш прогресс</h2>
  <p>Прогресс и записи хранятся в вашем браузере и никуда не отправляются. Нет аккаунтов, cookie и аналитики. Сейчас: <b id="home-save"></b>.</p>
  <ul>
   <li>Сохраняются: пройденные модули, результаты и ответы на вопросы, отметки на карточках, тексты практических ответов, схемы BPMN в заданиях, запросы SQL и последний открытый модуль.</li>
   <li>Не сохраняются намеренно: ввод в мелких тренажёрах и незаконченный итоговый экзамен.</li>
   <li>Прогресс привязан к браузеру, профилю и устройству. Между телефоном и компьютером он не синхронизируется.</li>
   <li>Он пропадёт, если очистить данные сайта, закрыть приватное окно или сменить браузер. Safari может сам удалить данные сайта примерно через неделю без посещений.</li>
   <li>Сделайте копию кнопкой «Экспорт» и восстановите её на другом устройстве кнопкой «Импорт». Импорт объединяет файл с тем, что уже есть.</li>
  </ul>
  <div class="row"><button class="btn" id="export-btn">Экспорт прогресса</button><button class="btn ghost" id="import-btn">Импорт прогресса</button><input type="file" id="import-file" accept="application/json,.json" hidden><button class="btn ghost" id="reset-btn">Сбросить прогресс</button><span id="reset-box"></span></div>
  <div id="import-msg" role="status" style="margin-top:10px"></div>
  </article>`;
  paintStatus();
  $('#export-btn').onclick = exportProgress;
  $('#import-btn').onclick = () => $('#import-file').click();
  $('#import-file').onchange = e => { importProgress(e.target.files[0], $('#import-msg')); e.target.value = ''; };
  $('#reset-btn').onclick = () => {
    $('#reset-box').innerHTML = '<span class="fb bad" style="margin:0">Стереть весь прогресс и ответы? <button class="btn" id="reset-yes">Да, стереть</button> <button class="btn ghost" id="reset-no">Отмена</button></span>';
    $('#reset-yes').onclick = () => { state = fresh(); touch(); route(); }; $('#reset-no').onclick = () => { $('#reset-box').innerHTML = ''; };
  };
}

/* ===== задания по BPMN ===== */
function renderLabs(v) {
  const rows = BPMN_TASKS.filter(t => !t.free).map(t => {
    const mi = COURSE.findIndex(m => m.id === t.mod);
    const ok = state.lab[t.id] && state.lab[t.id].ok;
    return `<tr><td>${esc(t.title)}</td><td>${['', 'Основы', 'Средний', 'Сложный'][t.level] || ''}</td><td>${mi >= 0 ? `<a href="#${t.mod}">Модуль ${mi + 1}</a>` : ''}</td><td>${ok ? '<span class="pill ok">выполнено</span>' : (state.lab[t.id] && state.lab[t.id].d ? '<span class="pill hold">начато</span>' : '')}</td></tr>`;
  }).join('');
  v.innerHTML = `<article class="sheet"><div class="eyebrow">Практикум</div><h1 style="font-size:1.8rem;margin:.3rem 0">Задания по BPMN</h1>
  <p class="lead">${BPMN_TASKS.filter(t => !t.free).length} заданий: от простой схемы с одним шлюзом до коллаборации с сообщениями и поиска ошибок в чужой схеме. Каждое задание находится в своём модуле, здесь собран список и свободный холст.</p>
  <div class="tbl"><table><thead><tr><th>Задание</th><th>Уровень</th><th>Где</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table></div>
  <h2>Свободный холст</h2><p>Рисуйте любой процесс из своей практики. Редактор проверит структуру и прогонит токен, а готовую схему можно скачать в формате .bpmn и открыть в bpmn.io или Camunda Modeler.</p>
  <div class="widget" data-w="bp-free"></div></article>`;
  const w = $('.widget', v), def = WIDGETS['bp-free'];
  if (def) { w.innerHTML = `<div class="w-head"><span>${def.title}</span><span>${def.tag}</span></div><div class="w-body"></div>`; def.init($('.w-body', w)); }
}

/* ===== экзамен ===== */
function examPool() { const p = []; COURSE.forEach(m => m.quiz.forEach(q => p.push(Object.assign({ mod: m.id, modTitle: m.short || m.title }, q)))); return p; }
function renderExam(v) {
  const best = state.quiz.exam;
  v.innerHTML = `<article class="sheet"><div class="eyebrow">Итоговый экзамен</div><h1 style="font-size:1.8rem;margin:.3rem 0">25 вопросов по всем модулям</h1>
  <p class="lead">Вопросы выбираются случайно. После экзамена вы увидите, какие модули стоит повторить.${best ? ` Лучший результат: <b>${best.best}/${best.total}</b>.` : ''} Незаконченный экзамен не сохраняется.</p>
  <div class="row"><button class="btn" id="ex-start">Начать экзамен</button></div><div id="ex-box"></div></article>`;
  $('#ex-start').onclick = () => {
    const qs = shuffle(examPool()).slice(0, 25);
    $('#ex-start').textContent = 'Новый экзамен';
    mountQuiz($('#ex-box'), qs, { id: 'exam', persist: false, onFinish: (c, t, res) => {
      recordQuiz('exam', c, t);
      const bad = {}; qs.forEach((q, i) => { if (res[i] === false) { bad[q.mod] = bad[q.mod] || { t: q.modTitle, n: 0 }; bad[q.mod].n++; } });
      const keys = Object.keys(bad);
      const sum = document.createElement('div'); sum.className = 'callout';
      sum.innerHTML = '<b>Что повторить</b>' + (keys.length ? '<ul>' + keys.map(k => `<li><a href="#${k}">${esc(bad[k].t)}</a>: ${bad[k].n} ${plural(bad[k].n, ['ошибка', 'ошибки', 'ошибок'])}</li>`).join('') + '</ul>' : 'Ошибок нет. Переходите к карточкам для собеседования.');
      $('#ex-box').appendChild(sum);
    } });
    $('#ex-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

/* ===== карточки ===== */
let cardFilter = 'all', cardIdx = 0, cardShown = false;
function renderCards(v) {
  const list = () => cardFilter === 'all' ? CARDS : CARDS.filter(c => !(state.cards[c.id] && state.cards[c.id].k === 1));
  const draw = () => {
    const Lst = list();
    if (!Lst.length) { v.innerHTML = `<article class="sheet"><h1 style="font-size:1.6rem">Все карточки отмечены «знаю»</h1><p class="lead">Покажите все карточки или снимите отметки с отдельных.</p><button class="btn" id="cf-all">Показать все</button></article>`; $('#cf-all').onclick = () => { cardFilter = 'all'; cardIdx = 0; draw(); }; return; }
    if (cardIdx >= Lst.length) cardIdx = 0; const c = Lst[cardIdx]; const k = (state.cards[c.id] || {}).k;
    v.innerHTML = `<article class="sheet"><div class="eyebrow">Карточки для собеседования · ${cardIdx + 1} из ${Lst.length}</div>
    <div class="row" style="margin:10px 0"><button class="btn ${cardFilter === 'all' ? '' : 'ghost'}" data-f="all">Все (${CARDS.length})</button><button class="btn ${cardFilter === 'rev' ? '' : 'ghost'}" data-f="rev">Без отметки «знаю» (${CARDS.filter(x => !(state.cards[x.id] && state.cards[x.id].k === 1)).length})</button><button class="btn ghost" data-sh="1">Перемешать</button></div>
    <div class="cardbox"><div class="eyebrow">${esc(c.tag || '')}${k === 1 ? ' · знаю' : k === 2 ? ' · повторить' : ''}</div><div class="cq">${c.q}</div>
    ${cardShown ? `<div class="prose">${c.a}</div><div class="row"><button class="btn" data-k="1">Знаю</button><button class="btn ghost" data-k="2">Повторить позже</button></div>` : `<div><button class="btn" data-show="1">Показать ответ</button></div>`}</div>
    <div class="row" style="margin-top:12px"><button class="btn ghost" data-nav="-1">← Назад</button><button class="btn ghost" data-nav="1">Дальше →</button></div>
    <p class="src">Сначала ответьте вслух, потом открывайте ответ. Формулировки близки к тем, что задают на собеседованиях. Карточки с пометкой «шаблон» нужно дополнить собственными фактами.</p></article>`;
    v.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.f) { cardFilter = b.dataset.f; cardIdx = 0; cardShown = false; draw(); }
      else if (b.dataset.sh) { const a = shuffle(CARDS); CARDS.splice(0, CARDS.length, ...a); cardIdx = 0; cardShown = false; draw(); }
      else if (b.dataset.show) { cardShown = true; draw(); }
      else if (b.dataset.k) { state.cards[c.id] = { k: +b.dataset.k, ts: Date.now() }; touch(); cardShown = false; if (!(cardFilter === 'rev' && b.dataset.k === '1')) cardIdx++; draw(); renderChrome(); }
      else if (b.dataset.nav) { cardIdx = (cardIdx + +b.dataset.nav + Lst.length) % Lst.length; cardShown = false; draw(); }
    };
  };
  draw();
}

/* ===== глоссарий ===== */
function renderGlossary(v) {
  v.innerHTML = `<article class="sheet"><div class="eyebrow">Глоссарий</div><h1 style="font-size:1.8rem;margin:.3rem 0">${GLOSS.length} ${plural(GLOSS.length, ['термин', 'термина', 'терминов'])} бизнес-анализа</h1>
  <p class="lead">Короткие рабочие определения. Для точных формулировок обращайтесь к стандартам и документам, на которые ведут ссылки в модулях.</p>
  <div class="field" style="max-width:420px"><label for="gl-q">Поиск</label><input type="text" id="gl-q" placeholder="шлюз, стейкхолдер, backlog…"></div>
  <div class="tbl"><table><thead><tr><th>Термин</th><th>Также</th><th>Что это</th></tr></thead><tbody id="gl-body"></tbody></table></div></article>`;
  const draw = q => { const s = q.trim().toLowerCase(); $('#gl-body').innerHTML = GLOSS.filter(g => !s || (g.t + ' ' + (g.alt || '') + ' ' + g.d).toLowerCase().includes(s)).map(g => `<tr class="gl-row"><td>${esc(g.t)}</td><td>${esc(g.alt || '')}</td><td>${g.d}</td></tr>`).join('') || '<tr><td colspan="3">Ничего не найдено</td></tr>'; };
  draw(''); $('#gl-q').oninput = e => draw(e.target.value);
}

/* ===== запуск ===== */
function boot() {
  const css = document.createElement('style'); css.id = 'bp-css'; css.textContent = BPMN.CSS; document.head.appendChild(css);
  $('#menu-btn').onclick = () => $('#nav').classList.toggle('open');
  window.addEventListener('hashchange', route);
  initStore(); route();
}
