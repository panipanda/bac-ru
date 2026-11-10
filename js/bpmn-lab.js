'use strict';
/* Редактор BPMN-схем для заданий: палитра, соединение потоков, дорожки и пулы, проверка, игра токенов, экспорт.
   Рисует через BPMN.renderSvg, сохранение и отметку «выполнено» получает через io = { load, save, ok, done }. */

const LAB_PAL = {
  start: ['start', 'none', 'Начало'], end: ['end', 'none', 'Конец'], task: ['task', 'none', 'Задача'],
  xor: ['xor', '', 'XOR'], and: ['and', '', 'AND'], or: ['or', '', 'OR'], evb: ['evb', '', 'По событию'],
  ievent: ['ievent', 'timer', 'Событие'], sub: ['sub', '', 'Подпроцесс'], call: ['call', '', 'Вызов'],
  data: ['data', '', 'Данные'], store: ['store', '', 'Хранилище'], note: ['note', '', 'Комментарий']
};
const LAB_PAL_ALL = ['start', 'end', 'task', 'xor', 'and', 'or', 'evb', 'ievent', 'sub', 'call', 'data', 'store', 'note'];

function mountLab(box, task, io) {
  const B = BPMN;
  const startModel = () => (task.start ? B.parseDsl(task.start) : B.empty());
  const ed = {
    m: B.fromJson(io.load()) || startModel(), tool: 'select', sel: null, src: null, marks: {}, sim: null, hist: [], drag: null,
    ok: io.ok(), lastSnap: ''
  };
  const pal = (task.pal || LAB_PAL_ALL).map(k => LAB_PAL[k]).filter(Boolean);
  const hasPools = !!task.pools || ed.m.pools.length > 0;
  const id = uid('lab');

  box.innerHTML = `<div class="lab">
  ${task.brief ? `<div class="lab-brief prose">${task.brief}</div>` : ''}
  <div class="lab-tools">
    <div class="tg" role="group" aria-label="Инструменты"><span class="tg-t">Инструмент</span>
      <button class="tbtn" type="button" data-tool="select" aria-pressed="true" title="Выбирать и двигать элементы">Выбрать</button>
      <button class="tbtn" type="button" data-tool="seq" aria-pressed="false" title="Поток последовательности: щёлкните источник, затем цель">Поток →</button>
      ${hasPools ? '<button class="tbtn" type="button" data-tool="msg" aria-pressed="false" title="Поток сообщений между пулами: щёлкните источник, затем цель">Сообщение ⇢</button>' : ''}
      ${pal.some(p => p[0] === 'data' || p[0] === 'note') ? '<button class="tbtn" type="button" data-tool="assoc" aria-pressed="false" title="Ассоциация данных или комментария с элементом">Связь ···</button>' : ''}
    </div>
    <div class="tg" role="group" aria-label="Элементы"><span class="tg-t">Добавить</span>${pal.map(p => `<button class="tbtn" type="button" data-add="${p[0]}" data-k="${p[1]}" aria-pressed="false" title="${esc(B.TYPE_RU[p[0]])}">${B.iconSvg(p[0], p[1])}<span>${p[2]}</span></button>`).join('')}</div>
    ${hasPools ? `<div class="tg" role="group" aria-label="Пулы и дорожки"><span class="tg-t">Пулы</span>
      <button class="tbtn" type="button" data-pool="1">+ Пул</button><button class="tbtn" type="button" data-pool="bb">+ Чёрный ящик</button><button class="tbtn" type="button" data-lane="1">+ Дорожка</button></div>` : ''}
  </div>
  <aside class="lab-side" aria-live="polite"></aside>
  <div class="lab-main"><div class="lab-canvas" tabindex="0" role="application" aria-label="Холст схемы BPMN"></div></div>
  <div class="lab-status" role="status" aria-live="polite"></div>
  <div class="lab-acts">
    <button class="btn" type="button" data-act="check">Проверить схему</button>
    <button class="btn ghost" type="button" data-act="sim">Прогнать токен</button>
    <button class="btn ghost" type="button" data-act="undo">Отменить</button>
    <button class="btn ghost" type="button" data-act="ref">Показать эталон</button>
    <button class="btn ghost" type="button" data-act="bpmn" title="Файл открывается в bpmn.io и Camunda Modeler">Скачать .bpmn</button>
    <button class="btn ghost" type="button" data-act="svg">Скачать SVG</button>
    <button class="btn ghost" type="button" data-act="reset">Начать заново</button><span data-slot="reset"></span>
  </div>
  ${(task.hints && task.hints.length) ? `<details><summary>Подсказки</summary><ul>${task.hints.map(h => `<li>${h}</li>`).join('')}</ul></details>` : ''}
  <div class="lab-out"></div><div class="lab-ref"></div></div>`;

  const canvas = $('.lab-canvas', box), side = $('.lab-side', box), status = $('.lab-status', box), out = $('.lab-out', box);
  const say = (t, err) => { status.textContent = t || ''; status.className = 'lab-status' + (err ? ' err' : ''); };

  /* ----- сохранение и история ----- */
  let saveTm = null;
  const persist = () => { clearTimeout(saveTm); saveTm = setTimeout(() => io.save(B.toJson(ed.m), ed.ok), 500); };
  const snap = () => { const j = B.toJson(ed.m); if (ed.hist[ed.hist.length - 1] !== j) { ed.hist.push(j); if (ed.hist.length > 60) ed.hist.shift(); } };
  const changed = () => { ed.marks = {}; draw(); persist(); };

  /* ----- рисование ----- */
  function draw() {
    const o = { sel: ed.sel && !/^(lane|pool):/.test(ed.sel) ? ed.sel : null, marks: Object.assign({}, ed.marks), minW: 900, minH: 340 };
    if (ed.src) o.marks[ed.src] = 'hot';
    if (ed.sim) { o.tokens = ed.sim.st.tok; o.pending = ed.sim.st.msg; Object.assign(o.marks, ed.sim.hot || {}); }
    let svg = B.renderSvg(ed.m, o);
    if (ed.sel && /^(lane|pool):/.test(ed.sel)) {
      const L = B.layout(ed.m), [kind, rid] = ed.sel.split(':');
      const t = kind === 'lane' ? L.lanes.find(l => l.id === rid) : L.pools.find(p => p.id === rid);
      if (t) {
        const w = +/viewBox="0 0 (\d+)/.exec(svg)[1];
        svg = svg.replace(/<\/svg>$/, `<rect class="bp-halo" x="2" y="${t.y + 2}" width="${w - 4}" height="${t.h - 4}"/></svg>`);
      }
    }
    canvas.innerHTML = svg;
    canvas.className = 'lab-canvas' + (ed.tool.startsWith('add:') ? ' add' : (ed.tool === 'seq' || ed.tool === 'msg' || ed.tool === 'assoc') ? ' link' : '');
  }
  function pt(ev) {
    const svg = $('svg', canvas), r = svg.getBoundingClientRect(), sc = svg.viewBox.baseVal.width / r.width;
    return { x: (ev.clientX - r.left) * sc, y: (ev.clientY - r.top) * sc };
  }
  function setTool(t) {
    ed.tool = t; ed.src = null;
    $$('[data-tool]', box).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    $$('[data-add]', box).forEach(b => b.setAttribute('aria-pressed', String('add:' + b.dataset.add + ':' + b.dataset.k === t)));
    const hints = { select: '', seq: 'Щёлкните элемент, из которого идёт поток, затем элемент, куда он ведёт.', msg: 'Щёлкните отправителя в одном пуле, затем получателя в другом.', assoc: 'Щёлкните объект данных или комментарий, затем связанный с ним элемент.' };
    say(t.startsWith('add:') ? 'Щёлкните по холсту, чтобы поставить элемент. Esc отменяет.' : hints[t] || '');
    draw();
  }

  /* ----- боковая панель ----- */
  function renderSide() {
    const s = ed.sel;
    if (ed.sim) { side.innerHTML = '<h4>Прогон токена</h4><div class="lab-hint">Схема только для просмотра. Нажимайте на шаги под схемой, чтобы провести токен, или запустите случайный путь до конца. «Остановить прогон» возвращает редактирование.</div>'; return; }
    if (!s) {
      side.innerHTML = `<h4>Как работать</h4><div class="lab-hint"><ul><li>Выберите элемент в блоке «Добавить» и щёлкните по холсту.</li><li>Перетаскивайте элементы мышью или пальцем.</li><li>Инструмент «Поток» соединяет два элемента двумя щелчками.</li><li>Двойной щелчок по элементу переходит к названию.</li><li>Delete удаляет выбранное, Ctrl+Z отменяет.</li></ul></div>`;
      return;
    }
    if (/^(lane|pool):/.test(s)) {
      const [kind, rid] = s.split(':'), L = B.layout(ed.m);
      if (kind === 'pool') {
        const p = ed.m.pools.find(x => x.id === rid); if (!p) { side.innerHTML = ''; return; }
        side.innerHTML = `<h4>${p.bb ? 'Пул (чёрный ящик)' : 'Пул'}</h4><div class="field"><label for="${id}-pn">Название</label><input type="text" id="${id}-pn" value="${esc(p.name)}" maxlength="80"></div>
        <div class="row">${p.bb ? '' : '<button class="btn ghost sm" data-s="addlane">+ Дорожка</button>'}<button class="btn ghost sm" data-s="delpool">Удалить пул</button></div>`;
        $('input', side).oninput = e => { p.name = e.target.value; changed(); };
      } else {
        const l = L.lanes.find(x => x.id === rid); if (!l) { side.innerHTML = ''; return; }
        const lane = ed.m.pools.find(p => p.id === l.pool).lanes.find(x => x.id === rid);
        side.innerHTML = `<h4>Дорожка</h4><div class="field"><label for="${id}-ln">Название (роль или отдел)</label><input type="text" id="${id}-ln" value="${esc(lane.name)}" maxlength="80"></div>
        <div class="row"><button class="btn ghost sm" data-s="taller">Выше</button><button class="btn ghost sm" data-s="shorter">Ниже</button><button class="btn ghost sm" data-s="addlane">+ Дорожка</button><button class="btn ghost sm" data-s="dellane">Удалить</button></div>`;
        $('input', side).oninput = e => { lane.name = e.target.value; changed(); };
      }
      return;
    }
    const n = B.nodeAt(ed.m, s), e = ed.m.edges.find(x => x.id === s);
    if (n) {
      const kinds = B.KINDS[n.t];
      const bndKinds = (n.t === 'task' || n.t === 'sub' || n.t === 'call') ? `<div class="field"><label for="${id}-bk">Граничное событие</label><div class="row"><select id="${id}-bk">${B.KINDS.bnd.map(k => `<option value="${k}">${B.KIND_RU[k]}</option>`).join('')}</select><button class="btn ghost sm" data-s="addbnd">Прикрепить</button></div></div>` : '';
      side.innerHTML = `<h4>${esc(B.TYPE_RU[n.t])}</h4>
      <div class="field"><label for="${id}-lb">${n.t === 'note' ? 'Текст' : 'Название'}</label><input type="text" id="${id}-lb" value="${esc(n.l)}" maxlength="160" autocomplete="off"></div>
      ${kinds ? `<div class="field"><label for="${id}-k">${n.t === 'task' ? 'Тип задачи' : 'Вид'}</label><select id="${id}-k">${kinds.map(k => `<option value="${k}" ${(n.k || kinds[0]) === k ? 'selected' : ''}>${B.KIND_RU[k]}</option>`).join('')}</select></div>` : ''}
      ${n.t === 'bnd' ? `<label class="chk"><input type="checkbox" id="${id}-ni" ${n.ni ? 'checked' : ''}><span>Не прерывает задачу (пунктир)</span></label>` : ''}
      ${bndKinds}
      <div class="row"><button class="btn ghost sm" data-s="del">Удалить</button></div>`;
      const lb = $('#' + id + '-lb', side);
      lb.onfocus = snap;
      lb.oninput = ev => { n.l = ev.target.value; changed(); };
      const ks = $('#' + id + '-k', side); if (ks) ks.onchange = ev => { snap(); n.k = ev.target.value; changed(); };
      const ni = $('#' + id + '-ni', side); if (ni) ni.onchange = ev => { snap(); n.ni = ev.target.checked; changed(); };
    } else if (e) {
      const a = B.nodeAt(ed.m, e.f);
      const canDef = e.k === 'seq' && a && ['xor', 'or', 'task', 'sub', 'call'].includes(a.t);
      side.innerHTML = `<h4>${e.k === 'msg' ? 'Поток сообщений' : e.k === 'assoc' ? 'Ассоциация' : 'Поток последовательности'}</h4>
      <div class="field"><label for="${id}-el">${e.k === 'seq' ? 'Подпись (условие ветки)' : 'Подпись'}</label><input type="text" id="${id}-el" value="${esc(e.l)}" maxlength="160" autocomplete="off"></div>
      ${canDef ? `<label class="chk"><input type="checkbox" id="${id}-df" ${e.d ? 'checked' : ''}><span>Поток по умолчанию (с косой чертой)</span></label>` : ''}
      <div class="row"><button class="btn ghost sm" data-s="del">Удалить</button></div>`;
      const el = $('#' + id + '-el', side); el.onfocus = snap; el.oninput = ev => { e.l = ev.target.value; changed(); };
      const df = $('#' + id + '-df', side); if (df) df.onchange = ev => { snap(); ed.m.edges.forEach(x => { if (x.f === e.f) delete x.d; }); if (ev.target.checked) e.d = true; changed(); };
    } else { ed.sel = null; renderSide(); }
  }
  side.addEventListener('click', ev => {
    const b = ev.target.closest('[data-s]'); if (!b) return;
    const s = ed.sel; if (!s) return;
    snap();
    switch (b.dataset.s) {
      case 'del': if (B.nodeAt(ed.m, s)) B.removeNode(ed.m, s); else B.removeEdge(ed.m, s); ed.sel = null; break;
      case 'addbnd': { const k = $('#' + id + '-bk', side).value; const nb = B.addBoundary(ed.m, s, k); if (nb) { ed.sel = nb.id; say('Граничное событие прикреплено. Проведите от него поток к тому, что делать при срабатывании.'); } break; }
      case 'addlane': { const [kind, rid] = s.split(':'); const L = B.layout(ed.m); const pid = kind === 'pool' ? rid : (L.lanes.find(l => l.id === rid) || {}).pool; if (pid) B.addLane(ed.m, pid); break; }
      case 'dellane': B.removeLane(ed.m, s.split(':')[1]); ed.sel = null; break;
      case 'delpool': B.removePool(ed.m, s.split(':')[1]); ed.sel = null; break;
      case 'taller': case 'shorter': { const rid = s.split(':')[1]; const lane = ed.m.pools.map(p => p.lanes.find(l => l.id === rid)).find(Boolean); if (lane) B.setLaneHeight(ed.m, rid, (lane.h || B.LANE_H) + (b.dataset.s === 'taller' ? 30 : -30)); break; }
    }
    changed(); renderSide();
  });

  /* ----- указатель ----- */
  function onDown(ev) {
    if (ed.sim) return;
    if (ev.button !== undefined && ev.button > 0) return;
    const p = pt(ev), nodeG = ev.target.closest('.bp-n'), edgeG = ev.target.closest('.bp-e'), poolG = ev.target.closest('[data-pool]');
    const nid = nodeG ? nodeG.dataset.id : null;
    canvas.focus({ preventScroll: true });
    if (ed.tool.startsWith('add:')) {
      const [, t, k] = ed.tool.split(':');
      snap();
      const n = B.addNode(ed.m, t, k || undefined, Math.max(30, p.x), Math.max(30, p.y));
      if (!n) { say('Слишком много элементов на схеме.', true); return; }
      ed.sel = n.id; setTool('select'); changed(); renderSide();
      if (t === 'task' || t === 'xor' || t === 'start' || t === 'end' || t === 'ievent' || t === 'sub' || t === 'note') { const lb = $('input[type=text]', side); if (lb) lb.focus(); }
      return;
    }
    if (ed.tool === 'seq' || ed.tool === 'msg' || ed.tool === 'assoc') {
      let target = nid;
      if (!target && poolG && ed.tool === 'msg') { const pool = ed.m.pools.find(x => x.id === poolG.dataset.pool); if (pool && pool.bb) target = pool.id; }
      if (!target) { say('Щёлкните по элементу схемы.', true); return; }
      if (!ed.src) { ed.src = target; say('Источник выбран. Теперь щёлкните элемент, куда ведёт поток (Esc отменяет).'); draw(); return; }
      snap();
      const r = B.addEdge(ed.m, ed.src, target, ed.tool);
      ed.src = null;
      if (r.err) { ed.hist.pop(); say(r.err, true); draw(); return; }
      say('Поток добавлен. Выберите его, чтобы подписать.');
      ed.sel = r.edge.id; changed(); renderSide();
      return;
    }
    /* инструмент «Выбрать» */
    if (nid) {
      ed.sel = nid;
      const n = B.nodeAt(ed.m, nid);
      if (n && n.t !== 'bnd') { ed.drag = { id: nid, dx: p.x - n.x, dy: p.y - n.y, moved: false, before: B.toJson(ed.m) }; try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* не страшно */ } }
      draw(); renderSide(); return;
    }
    if (edgeG) { ed.sel = edgeG.dataset.id; draw(); renderSide(); return; }
    /* заголовки пулов и дорожек */
    const L = B.layout(ed.m);
    const pl = L.pools.find(x => p.y >= x.y && p.y < x.y + x.h);
    if (pl && p.x < 64) {
      const named = pl.lanes.length > 1 || (pl.lanes[0] && pl.lanes[0].name);
      if (p.x < 32 || pl.bb || !named) ed.sel = 'pool:' + pl.id;
      else { const ln = L.laneAt(p.x, p.y); ed.sel = ln ? 'lane:' + ln.id : 'pool:' + pl.id; }
    } else ed.sel = null;
    draw(); renderSide();
  }
  let raf = 0;
  function onMove(ev) {
    if (!ed.drag) return;
    const p = pt(ev), n = B.nodeAt(ed.m, ed.drag.id); if (!n) return;
    const nx = Math.max(20, Math.round((p.x - ed.drag.dx) / 10) * 10), ny = Math.max(20, Math.round((p.y - ed.drag.dy) / 10) * 10);
    if (nx !== n.x || ny !== n.y) { n.x = nx; n.y = ny; ed.drag.moved = true; }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }
  function onUp(ev) {
    if (!ed.drag) return;
    const d = ed.drag; ed.drag = null;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* не страшно */ }
    if (d.moved) { ed.hist.push(d.before); if (ed.hist.length > 60) ed.hist.shift(); changed(); }
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('dblclick', ev => { if (ev.target.closest('.bp-n,.bp-e') && !ed.sim) { const lb = $('input[type=text]', side); if (lb) { lb.focus(); lb.select(); } } });
  /* Клавиши работают, пока фокус внутри редактора и не в поле ввода. */
  box.addEventListener('keydown', ev => {
    if (ed.sim || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if (ev.key === 'Escape') { setTool('select'); ed.sel = null; draw(); renderSide(); return; }
    if ((ev.key === 'z' || ev.key === 'я') && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); undo(); return; }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && ed.sel && !/^(lane|pool):/.test(ed.sel)) {
      ev.preventDefault(); snap();
      if (B.nodeAt(ed.m, ed.sel)) B.removeNode(ed.m, ed.sel); else B.removeEdge(ed.m, ed.sel);
      ed.sel = null; changed(); renderSide(); return;
    }
    const n = ed.sel && B.nodeAt(ed.m, ed.sel);
    const dir = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[ev.key];
    if (n && dir && n.t !== 'bnd') { ev.preventDefault(); snap(); n.x = Math.max(20, n.x + dir[0]); n.y = Math.max(20, n.y + dir[1]); changed(); }
  });

  /* ----- кнопки ----- */
  function undo() {
    const j = ed.hist.pop();
    if (!j) { say('Отменять нечего.'); return; }
    const m = B.fromJson(j); if (!m) return;
    ed.m = m; ed.sel = null; ed.src = null; changed(); renderSide();
  }
  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  box.addEventListener('click', ev => {
    const t = ev.target.closest('[data-tool]');
    if (t) { if (!ed.sim) setTool(t.dataset.tool); return; }
    const a = ev.target.closest('[data-add]');
    if (a) { if (!ed.sim) setTool('add:' + a.dataset.add + ':' + a.dataset.k); return; }
    const pl = ev.target.closest('[data-pool]');
    if (pl && pl.tagName === 'BUTTON') {
      if (ed.sim) return; snap();
      const p = B.addPool(ed.m, pl.dataset.pool === 'bb' ? 'Клиент' : 'Организация', pl.dataset.pool === 'bb');
      if (!p) { ed.hist.pop(); say('Достигнут предел числа пулов.', true); return; }
      ed.sel = 'pool:' + p.id; changed(); renderSide(); say('Пул добавлен. Переименуйте его в панели над схемой и перетащите элементы в нужные дорожки.'); return;
    }
    const ln = ev.target.closest('[data-lane]');
    if (ln && ln.tagName === 'BUTTON') {
      if (ed.sim) return;
      let pid = null;
      if (ed.sel && /^pool:/.test(ed.sel)) pid = ed.sel.split(':')[1];
      else if (ed.sel && /^lane:/.test(ed.sel)) pid = (B.layout(ed.m).lanes.find(l => l.id === ed.sel.split(':')[1]) || {}).pool;
      if (pid && (ed.m.pools.find(p => p.id === pid) || {}).bb) pid = null;
      if (!pid) { const wp = ed.m.pools.filter(p => !p.bb); pid = wp.length ? wp[wp.length - 1].id : null; }
      if (!pid) { say('Сначала добавьте пул (не «чёрный ящик»): дорожки бывают только в обычных пулах.', true); return; }
      snap(); B.addLane(ed.m, pid); changed(); renderSide(); return;
    }
    const act = ev.target.closest('[data-act]');
    if (!act) {
      const go = ev.target.closest('[data-focus]');
      if (go) { ed.sel = go.dataset.focus; draw(); renderSide(); const el = canvas.querySelector(`[data-id="${go.dataset.focus}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' }); }
      return;
    }
    switch (act.dataset.act) {
      case 'check': if (ed.sim) simStop(); runCheck(); break;
      case 'sim': if (ed.sim) simStop(); else simStart(); break;
      case 'undo': if (!ed.sim) undo(); break;
      case 'ref': { const r = $('.lab-ref', box); if (r.innerHTML) { r.innerHTML = ''; act.textContent = 'Показать эталон'; } else { r.innerHTML = `<div class="callout"><b>Эталонное решение</b>Это один из возможных вариантов. Ваша схема тоже верна, если описывает тот же процесс и проходит проверку структуры.</div>${B.fig(task.ref, task.refNote || 'Эталонное решение')}`; act.textContent = 'Скрыть эталон'; } break; }
      case 'bpmn': download((task.id || 'diagram') + '.bpmn', B.toXml(ed.m), 'application/xml'); break;
      case 'svg': download((task.id || 'diagram') + '.svg', B.renderSvg(ed.m, { standalone: true }), 'image/svg+xml'); break;
      case 'reset': {
        const slot = $('[data-slot="reset"]', box);
        slot.innerHTML = ' <span class="fb bad" style="margin:0">Стереть схему и начать заново? <button class="btn sm" data-act="reset-yes">Да</button> <button class="btn ghost sm" data-act="reset-no">Нет</button></span>';
        break;
      }
      case 'reset-yes': snap(); ed.m = startModel(); ed.sel = null; ed.src = null; $('[data-slot="reset"]', box).innerHTML = ''; out.innerHTML = ''; changed(); renderSide(); break;
      case 'reset-no': $('[data-slot="reset"]', box).innerHTML = ''; break;
      case 'sim-step': simStep(+act.dataset.i); break;
      case 'sim-auto': simAuto(); break;
      case 'sim-reset': simReset(); break;
      case 'sim-stop': simStop(); break;
    }
  });

  /* ----- проверка ----- */
  function runCheck() {
    const lint = B.lint(ed.m), M = B.checker(ed.m);
    const reqs = (task.checks || []).map(c => { let ok = false; try { ok = !!c.f(M); } catch (e) { ok = false; } return { t: c.t, h: c.h, ok }; });
    ed.marks = {};
    lint.forEach(r => { if (r.id && r.lvl !== 'tip') ed.marks[r.id] = r.lvl === 'error' ? 'bad' : 'warn'; });
    const c = B.counts(lint);
    const flowN = ed.m.nodes.filter(n => B.isFlow(n.t)).length;
    const passed = c.error === 0 && reqs.every(r => r.ok) && (task.free ? flowN >= 3 : true);
    const mk = { error: '✗', warn: '!', tip: '·' };
    const li = r => `<li class="${r.lvl === 'error' ? 'bad' : r.lvl}"><span class="mk">${mk[r.lvl]}</span><span>${esc(r.msg)}</span>${r.id ? `<button class="btn ghost sm go" data-focus="${esc(r.id)}">Показать</button>` : ''}</li>`;
    const order = { error: 0, warn: 1, tip: 2 };
    let h = `<div class="res-h">Структура схемы: ${c.error ? c.error + ' ' + plural(c.error, ['ошибка', 'ошибки', 'ошибок']) : 'ошибок нет'}${c.warn ? ', предупреждений ' + c.warn : ''}${c.tip ? ', советов ' + c.tip : ''}</div>`;
    h += lint.length ? `<ul class="res">${lint.slice().sort((a, b) => order[a.lvl] - order[b.lvl]).map(li).join('')}</ul>` : '<ul class="res"><li class="ok"><span class="mk">✓</span><span>Структура в порядке: начало, конец, ветки и слияния согласованы, процесс проходит до конца.</span></li></ul>';
    if (reqs.length) {
      h += `<div class="res-h">Требования задания: ${reqs.filter(r => r.ok).length} из ${reqs.length}</div><ul class="res">${reqs.map(r => `<li class="${r.ok ? 'ok' : 'bad'}"><span class="mk">${r.ok ? '✓' : '✗'}</span><span>${r.t}${!r.ok && r.h ? ` <span class="src">Подсказка: ${r.h}</span>` : ''}</span></li>`).join('')}</ul>`;
    }
    h += passed
      ? `<div class="fb ok"><b>Задание выполнено.</b> ${task.free ? 'Схема проходит проверку структуры.' : 'Схема отвечает требованиям и проходит проверку структуры.'} Сравните со своим вариантом эталон: названия и раскладка могут отличаться, важна логика.</div>`
      : `<div class="fb bad">Пока не всё сходится. Исправьте отмеченное (красным и жёлтым на схеме) и проверьте ещё раз. Проверка ищет ключевые слова в названиях, поэтому если шаг назван иначе, посмотрите в подсказке, о каком шаге речь.</div>`;
    out.innerHTML = h;
    if (passed && !ed.ok) { ed.ok = true; io.save(B.toJson(ed.m), true); if (io.done) io.done(); }
    else if (passed) io.save(B.toJson(ed.m), true);
    draw();
  }

  /* ----- игра токенов ----- */
  function simStart() {
    const lint = B.lint(ed.m, { skipSim: true });
    if (!ed.m.nodes.some(n => n.t === 'start')) { say('Добавьте начальное событие: токену неоткуда стартовать.', true); return; }
    ed.sim = { S: B.setup(ed.m), st: B.simInit(), log: [], hot: {}, timer: null };
    ed.sel = null; ed.src = null; ed.marks = {};
    box.classList.add('simming');
    $$('.tbtn', box).forEach(b => { b.disabled = true; });
    $('[data-act="sim"]', box).textContent = 'Остановить прогон';
    say('Режим токена: выбирайте, какой шаг выполнить. Схему в этом режиме менять нельзя.');
    renderSide(); simRender();
  }
  function simStop() {
    if (!ed.sim) return;
    clearInterval(ed.sim.timer); ed.sim = null;
    box.classList.remove('simming');
    $$('.tbtn', box).forEach(b => { b.disabled = false; });
    $('[data-act="sim"]', box).textContent = 'Прогнать токен';
    out.innerHTML = ''; say(''); draw(); renderSide();
  }
  function simReset() { clearInterval(ed.sim.timer); ed.sim.st = B.simInit(); ed.sim.log = []; ed.sim.hot = {}; simRender(); }
  function simRender() {
    const s = ed.sim; if (!s) return;
    const mv = B.moves(s.S, s.st); s.mv = mv;
    let h = '<div class="res-h">Игра токенов</div><p class="src">Токен это текущее состояние процесса. Синий кружок на потоке означает, что шаг впереди готов к выполнению. Конверт на пунктирной линии означает отправленное, но ещё не принятое сообщение.</p>';
    if (mv.length) {
      h += `<div class="sim-moves">${mv.map((x, i) => `<button class="tbtn" type="button" data-act="sim-step" data-i="${i}" data-n="${esc(x.n)}">${esc(x.text)}</button>`).join('')}</div><div class="row"><button class="btn ghost sm" data-act="sim-auto">Случайный путь до конца</button><button class="btn ghost sm" data-act="sim-reset">Сначала</button></div>`;
    } else {
      const ids = Object.keys(s.st.tok);
      if (!ids.length) h += '<div class="fb ok"><b>Процесс завершился чисто.</b> Токенов не осталось, все ветки дошли до конца.</div>';
      else {
        const e = ed.m.edges.find(x => x.id === ids[0]), t = e && B.nodeAt(ed.m, e.to);
        h += `<div class="fb bad"><b>Процесс завис.</b> Токен остался перед элементом ${t && t.l ? '«' + esc(t.l) + '»' : 'схемы'}, ходов больше нет. Так выглядит взаимоблокировка: например, параллельный шлюз ждёт ветку, по которой токен не пошёл.</div>`;
        if (t) s.hot = { [t.id]: 'bad' };
      }
      h += '<div class="row"><button class="btn ghost sm" data-act="sim-reset">Сначала</button></div>';
    }
    if (s.log.length) h += `<ol class="sim-log">${s.log.slice(-12).map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
    out.innerHTML = h;
    $$('.sim-moves .tbtn', out).forEach(b => {
      const on = () => { s.hot = { [b.dataset.n]: 'hot' }; draw(); }, off = () => { s.hot = {}; draw(); };
      b.addEventListener('mouseenter', on); b.addEventListener('focus', on); b.addEventListener('mouseleave', off); b.addEventListener('blur', off);
    });
    draw();
  }
  function simStep(i) {
    const s = ed.sim; if (!s || !s.mv[i]) return;
    s.log.push(s.mv[i].text);
    s.st = B.fire(s.S, s.st, s.mv[i]); s.hot = {};
    simRender();
  }
  function simAuto() {
    const s = ed.sim; clearInterval(s.timer);
    s.timer = setInterval(() => {
      if (!box.isConnected || ed.sim !== s) { clearInterval(s.timer); return; }
      const mv = B.moves(s.S, s.st);
      if (!mv.length) { clearInterval(s.timer); return; }
      s.mv = mv; simStep(Math.floor(Math.random() * mv.length));
    }, 600);
  }

  setTool('select'); renderSide();
  if (task.autoCheck) { /* зарезервировано */ }
  return { ed };
}

/* Подключает все задания из BPMN_TASKS как тренажёры {{w:bp-<id>}}. Хранение через состояние приложения. */
function registerLabs() {
  BPMN_TASKS.forEach(t => {
    WIDGETS['bp-' + t.id] = {
      title: t.free ? 'Свободный холст BPMN' : 'Практикум BPMN: ' + t.title, tag: t.free ? 'редактор' : 'схема',
      init(b) {
        mountLab(b, t, {
          load: () => (state.lab[t.id] || {}).d || '',
          ok: () => !!(state.lab[t.id] && state.lab[t.id].ok),
          save: (d, ok) => { const o = state.lab[t.id] || {}; state.lab[t.id] = { ok: (ok || o.ok) ? 1 : 0, ts: Date.now(), d: d.length <= LIMITS.diagram ? d : (o.d || '') }; touch(); },
          done: () => renderChrome()
        });
      }
    };
  });
}
