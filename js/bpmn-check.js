'use strict';
/* BPMN: проверка схемы (стиль и структура), игра токенов, поиск зависаний и повторов, экспорт в .bpmn.
   Дополняет объект BPMN из bpmn.js. Файл не обращается к DOM. */

(function () {
  const B = BPMN;
  const { isGate } = B;
  const CAP = 3, STATE_LIMIT = 4000;
  const q = s => '«' + (s || '').trim() + '»';
  const name = n => n ? (n.l && n.l.trim() ? q(n.l) : '(без названия: ' + (B.TYPE_RU[n.t] || n.t).toLowerCase() + ')') : '';

  /* ===== проверка схемы ===== */
  function lint(m, opts) {
    opts = opts || {};
    const res = [];
    const add = (lvl, code, id, msg) => res.push({ lvl, code, id, msg });
    const L = B.layout(m), I = B.idx(m);
    const flow = m.nodes.filter(n => B.isFlow(n.t));
    const scopeOf = n => (m.pools.length ? B.poolOf(L, n) : '*');
    const scopes = {};
    flow.forEach(n => { const s = scopeOf(n); (scopes[s || '-'] = scopes[s || '-'] || []).push(n); });

    if (!flow.length) { add('error', 'EMPTY', null, 'Схема пуста: добавьте хотя бы начальное событие, задачу и конечное событие.'); return res; }
    if (m.pools.length && scopes['-']) scopes['-'].forEach(n => add('warn', 'OUTSIDE', n.id, name(n) + ' лежит вне пула. Поместите элемент в дорожку.'));

    Object.keys(scopes).forEach(s => {
      if (s === '-') return;
      const nodes = scopes[s];
      const pool = m.pools.find(p => p.id === s);
      const where = pool && m.pools.length > 1 ? ' в пуле ' + q(pool.name) : '';
      const hasStart = nodes.some(n => n.t === 'start'), hasEnd = nodes.some(n => n.t === 'end');
      if (!hasStart) add('error', 'NO_START', nodes[0].id, 'Нет начального события' + where + '. Процесс должен с чего-то начинаться.');
      if (!hasEnd) add('error', 'NO_END', nodes[0].id, 'Нет конечного события' + where + '. Покажите, чем заканчивается процесс.');
    });

    flow.forEach(n => {
      const oS = I.outS[n.id], iS = I.inS[n.id], oM = I.outM[n.id], iM = I.inM[n.id];
      const lab = (n.l || '').trim();
      if (n.t === 'start' && iS.length) add('error', 'START_IN', n.id, 'У начального события ' + name(n) + ' не должно быть входящих потоков.');
      if (n.t === 'end' && oS.length) add('error', 'END_OUT', n.id, 'У конечного события ' + name(n) + ' не должно быть исходящих потоков.');
      if (n.t !== 'end' && !oS.length && n.t !== 'bnd' && !(n.t === 'ievent' && n.k === 'linkT'))
        add('error', 'DEAD_END', n.id, 'После ' + name(n) + ' процесс обрывается: нет исходящего потока. Добавьте следующий шаг или конечное событие.');
      if (n.t === 'bnd' && !oS.length) add('warn', 'BND_OUT', n.id, 'У граничного события ' + name(n) + ' нет исходящего потока: непонятно, что делать, когда оно сработало.');
      if (!['start', 'bnd'].includes(n.t) && !iS.length && !(n.t === 'ievent' && iM.length) && !(n.t === 'start')) add('error', 'NO_IN', n.id, name(n) + ' недостижим: в него не входит ни один поток.');
      if (n.t === 'task' && !lab) add('error', 'TASK_EMPTY', n.id, 'У задачи нет названия. Назовите её глаголом и объектом, например «Проверить заявку».');
      if (n.t === 'sub' && !lab) add('error', 'SUB_EMPTY', n.id, 'У подпроцесса нет названия.');
      if ((n.t === 'task' || n.t === 'sub') && lab) {
        if (/[а-яё]/i.test(lab) && n.t === 'task' && !/^(не\s+)?[а-яё-]+(ть|ти|чь|ться|тись)(\s|$)/i.test(lab) && !/^(?:[А-ЯЁа-яё]+\s)?[А-ЯЁа-яё-]+(ть|ти|чь)(ся)?\s/i.test(lab))
          add('tip', 'TASK_NAME', n.id, 'Название задачи ' + q(lab) + ' лучше начать с глагола в неопределённой форме: «Проверить заявку», «Отправить письмо».');
        if (lab.length > 60) add('tip', 'LONG', n.id, 'Название ' + q(lab) + ' слишком длинное. Сократите до глагола и объекта, детали вынесите в описание.');
      }
      if (['start', 'end', 'ievent'].includes(n.t) && !lab) add('tip', 'EVENT_NAME', n.id, 'Назовите событие: существительное и причастие, например «Заявка получена», «Заказ отменён».');
      if (n.t === 'ievent' && !iS.length && !iM.length) { /* уже учтено как NO_IN */ }
      if (!isGate(n.t) && n.t !== 'end' && oS.length > 1 && n.t !== 'bnd') add('warn', 'IMPLICIT_SPLIT', n.id, name(n) + ' имеет несколько исходящих потоков. Это неявное параллельное ветвление, поэтому поставьте шлюз и покажите, выполняются ветки вместе или по условию.');
      if (!isGate(n.t) && !['start', 'end'].includes(n.t) && iS.length > 1) add('warn', 'IMPLICIT_MERGE', n.id, 'В ' + name(n) + ' входит несколько потоков. Соедините ветки шлюзом, чтобы было понятно, ждёт элемент все ветки или любую.');
      if (isGate(n.t)) {
        if (iS.length === 1 && oS.length === 1) add('warn', 'GATE_USELESS', n.id, 'Шлюз ' + name(n) + ' имеет один вход и один выход и ничего не решает. Удалите его.');
        if (iS.length > 1 && oS.length > 1) add('warn', 'GATE_MIXED', n.id, 'Шлюз ' + name(n) + ' одновременно объединяет и разветвляет потоки. Разделите его на два шлюза: слияние и ветвление.');
        if (oS.length > 1 && (n.t === 'xor' || n.t === 'or')) {
          const noLab = oS.filter(e => !(e.l || '').trim() && !e.d);
          if (noLab.length) add('error', 'GATE_LABELS', n.id, 'У веток после шлюза ' + name(n) + ' нет условий (' + noLab.length + ' шт.). Подпишите каждую ветку ответом: «Да», «Нет», «Сумма до 1000» и так далее.');
          if (!lab) add('tip', 'GATE_NAME', n.id, 'Назовите шлюз вопросом: «Заявка полная?». Тогда подписи веток читаются как ответы.');
          else if (!/\?\s*$/.test(lab)) add('tip', 'GATE_Q', n.id, 'Название шлюза ' + q(lab) + ' лучше сформулировать вопросом.');
        }
        if (oS.length > 1 && n.t === 'evb' && !oS.every(e => { const t = I.by[e.to]; return t && (t.t === 'ievent' || (t.t === 'task' && t.k === 'receive')); }))
          add('error', 'EVB_TARGET', n.id, 'После шлюза по событиям ' + name(n) + ' должны идти события (сообщение, таймер, сигнал) или задача получения.');
      }
      if (n.t === 'xor' && oS.length > 1 && iS.length <= 1 && oS.some(e => e.d) && oS.filter(e => e.d).length > 1) add('error', 'GATE_DEFAULT', n.id, 'Поток по умолчанию у шлюза ' + name(n) + ' может быть только один.');
    });

    m.edges.forEach(e => {
      const a = I.by[e.f], b = I.by[e.to];
      const pa = a ? B.poolOf(L, a) : e.f, pb = b ? B.poolOf(L, b) : e.to;
      if (e.k === 'seq' && m.pools.length && pa && pb && pa !== pb) add('error', 'CROSS', e.id, 'Поток последовательности пересекает границу пула (' + name(a) + ' → ' + name(b) + '). Между пулами проводят поток сообщений.');
      if (e.k === 'msg') {
        if (!m.pools.length) add('warn', 'MSG_NOPOOL', e.id, 'Поток сообщений нужен между пулами. Добавьте пулы участников.');
        else if (pa && pb && pa === pb) add('error', 'MSG_SAME', e.id, 'Поток сообщений соединяет элементы одного пула (' + name(a) + ' → ' + name(b) + '). Внутри пула используют поток последовательности.');
        if (a && isGate(a.t)) add('error', 'MSG_GATE', e.id, 'Шлюз не отправляет сообщения.');
        if (b && isGate(b.t)) add('error', 'MSG_GATE', e.id, 'Шлюз не принимает сообщения.');
      }
    });

    /* Достижимость от начальных событий. */
    const seen = new Set();
    const stack = flow.filter(n => n.t === 'start').map(n => n.id);
    flow.filter(n => n.t === 'ievent' && !I.inS[n.id].length && I.inM[n.id].length).forEach(n => stack.push(n.id));
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      (I.outS[id] || []).forEach(e => stack.push(e.to));
      m.nodes.forEach(n => { if (n.t === 'bnd' && n.host === id) stack.push(n.id); });
    }
    flow.forEach(n => {
      if (!seen.has(n.id) && I.inS[n.id].length && !res.some(r => r.id === n.id && r.code === 'NO_IN')) add('error', 'UNREACH', n.id, name(n) + ' не достижим ни из одного начального события.');
    });
    /* Условная проверка: поведение процесса (зависание, повторное выполнение). */
    if (!opts.skipSim && !res.some(r => r.lvl === 'error' && ['NO_START', 'EMPTY'].includes(r.code)) && flow.length <= 60) {
      const a = analyze(m);
      if (a.deadlock) add('error', 'SIM_DEADLOCK', a.deadlock.node, a.deadlock.msg);
      a.multi.forEach(x => add('warn', 'SIM_MULTI', x.node, x.msg));
      if (a.unbounded) add('warn', 'SIM_UNBOUNDED', null, 'Токены накапливаются без предела: вероятно, цикл с параллельным ветвлением без слияния.');
      if (!a.deadlock && !a.completed && !a.truncated && !a.unbounded) add('warn', 'SIM_NEVER_ENDS', null, 'Ни один сценарий не доходит до конца чисто: процесс не завершается или остаются «лишние» токены.');
    }
    return res;
  }
  const counts = r => ({ error: r.filter(x => x.lvl === 'error').length, warn: r.filter(x => x.lvl === 'warn').length, tip: r.filter(x => x.lvl === 'tip').length });

  /* ===== игра токенов ===== */
  function setup(m) {
    const I = B.idx(m), L = B.layout(m);
    const flow = m.nodes.filter(n => B.isFlow(n.t) && n.t !== 'bnd');
    const bnd = {};
    m.nodes.forEach(n => { if (n.t === 'bnd') (bnd[n.host] = bnd[n.host] || []).push(n); });
    const scope = {};
    flow.forEach(n => { scope[n.id] = m.pools.length ? B.poolOf(L, n) : '*'; });
    return { m, I, L, flow, bnd, scope };
  }
  function simInit() { return { tok: {}, msg: {}, started: {}, ended: {}, flags: {} }; }
  const cp = st => ({ tok: Object.assign({}, st.tok), msg: Object.assign({}, st.msg), started: Object.assign({}, st.started), ended: Object.assign({}, st.ended), flags: Object.assign({}, st.flags) });
  const lbl = (S, n) => n.l && n.l.trim() ? q(n.l) : (isGate(n.t) ? 'без названия' : (B.TYPE_RU[n.t] || n.t).toLowerCase());

  function reachFrom(S, edgeIds, stopAt) {
    const seen = new Set(), stack = edgeIds.map(id => S.I.by[S.m.edges.find(e => e.id === id).to]).filter(Boolean).map(n => n.id);
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id) || id === stopAt) continue;
      seen.add(id);
      (S.I.outS[id] || []).forEach(e => stack.push(e.to));
      (S.bnd[id] || []).forEach(b => stack.push(b.id));
    }
    return seen;
  }
  function subsets(arr) {
    if (arr.length > 3) return arr.map(a => [a]).concat([arr.slice()]);
    const out = [];
    for (let mask = 1; mask < (1 << arr.length); mask++) out.push(arr.filter((_, i) => mask & (1 << i)));
    return out;
  }
  function needsMsg(S, n) {
    const im = S.I.inM[n.id];
    if (im.length) return im;
    return null;
  }
  /* Список доступных ходов. Ход: { n, from, msgIn, pick, via, text }. */
  function moves(S, st) {
    const out = [], I = S.I;
    const tokIn = n => I.inS[n.id].filter(e => (st.tok[e.id] || 0) > 0);
    /* Сообщение от пула-«чёрного ящика» считается доступным всегда: его процесс неизвестен. */
    const hasMsg = x => !!I.pools[x.f] || (st.msg[x.id] || 0) > 0;
    const msgAvail = n => { const im = needsMsg(S, n); return im ? im.find(hasMsg) || false : true; };
    S.flow.forEach(n => {
      const oS = I.outS[n.id];
      switch (n.t) {
        case 'start': {
          if (st.started[n.id]) break;
          const im = I.inM[n.id];
          if (n.k === 'msg' || im.length) {
            const e = im.find(hasMsg);
            if (e) out.push({ n: n.id, msgIn: e.id, text: 'Пришло сообщение: запускается ' + lbl(S, n) });
          } else out.push({ n: n.id, text: 'Запустить процесс: ' + lbl(S, n) });
          break;
        }
        case 'task': case 'sub': case 'call': {
          const mi = msgAvail(n);
          if (!mi) break;
          tokIn(n).forEach(e => {
            const base = { n: n.id, from: e.id, msgIn: mi === true ? undefined : mi.id };
            out.push(Object.assign({ text: 'Выполнить ' + lbl(S, n) }, base));
            (S.bnd[n.id] || []).forEach(b => out.push(Object.assign({ via: b.id, text: 'Пока выполняется ' + lbl(S, n) + ' сработало граничное событие ' + lbl(S, b) }, base)));
          });
          break;
        }
        case 'ievent': {
          if (n.k === 'linkT' || n.k === 'link') { tokIn(n).forEach(e => out.push({ n: n.id, from: e.id, text: 'Пройти событие ' + lbl(S, n) })); break; }
          const mi = (n.k === 'msg') ? msgAvail(n) : true;
          if (!mi) break;
          tokIn(n).forEach(e => out.push({ n: n.id, from: e.id, msgIn: mi === true || n.k !== 'msg' ? undefined : mi.id, text: (n.k === 'timer' ? 'Прошло время: ' : n.k === 'msg' ? 'Сообщение получено: ' : 'Событие: ') + lbl(S, n) }));
          break;
        }
        case 'end':
          tokIn(n).forEach(e => out.push({ n: n.id, from: e.id, text: 'Завершить: ' + lbl(S, n) }));
          break;
        case 'xor':
          tokIn(n).forEach(e => {
            if (oS.length > 1) oS.forEach(o => out.push({ n: n.id, from: e.id, pick: [o.id], text: (n.l && n.l.trim() ? q(n.l) + ' → ' : 'Выбор: ') + (o.l && o.l.trim() ? q(o.l) : 'ветка без подписи') }));
            else out.push({ n: n.id, from: e.id, pick: oS.map(o => o.id), text: 'Пройти шлюз (' + lbl(S, n) + ')' });
          });
          break;
        case 'and': {
          const ins = I.inS[n.id];
          if (ins.length && ins.every(e => (st.tok[e.id] || 0) > 0)) out.push({ n: n.id, from: ins.map(e => e.id), pick: oS.map(o => o.id), text: oS.length > 1 ? 'Параллельный шлюз (' + lbl(S, n) + '): запустить все ветки' : 'Параллельный шлюз (' + lbl(S, n) + '): дождались всех веток' });
          break;
        }
        case 'or': {
          const ins = I.inS[n.id];
          let ready = tokIn(n);
          if (!ready.length) break;
          if (ins.length > 1) {
            const empty = ins.filter(e => !(st.tok[e.id] > 0));
            const other = Object.keys(st.tok).filter(k => st.tok[k] > 0 && !ready.some(r => r.id === k));
            const reach = reachFrom(S, other, n.id);
            const wait = empty.some(e => { const src = e.f; return reach.has(src) || other.includes(e.id); });
            if (wait) break;
          }
          const subs = oS.length > 1 ? subsets(oS) : [oS];
          subs.forEach(sub => out.push({ n: n.id, from: ready.map(e => e.id), pick: sub.map(o => o.id), text: (n.l && n.l.trim() ? q(n.l) : 'Включающий шлюз') + (oS.length > 1 ? ' → ' + sub.map(o => o.l && o.l.trim() ? q(o.l) : 'ветка').join(' + ') : '') }));
          break;
        }
        case 'evb':
          tokIn(n).forEach(e => oS.forEach(o => {
            const t = I.by[o.to];
            if (!t) return;
            if (t.t === 'ievent' || (t.t === 'task' && t.k === 'receive')) {
              const need = (t.t === 'task' || t.k === 'msg') ? msgAvail(t) : true;
              if (!need) return;
              out.push({ n: n.id, from: e.id, via: o.id, msgIn: need === true ? undefined : need.id, text: 'Шлюз по событиям (' + lbl(S, n) + '): раньше наступило ' + lbl(S, t) });
            } else out.push({ n: n.id, from: e.id, pick: [o.id], text: 'Шлюз по событиям → ' + lbl(S, t) });
          }));
          break;
      }
    });
    return out;
  }
  function produce(S, st, edgeId) {
    st.tok[edgeId] = (st.tok[edgeId] || 0) + 1;
    if (st.tok[edgeId] > 1) st.flags['m:' + edgeId] = 1;
    if (st.tok[edgeId] > CAP) st.flags.unb = 1;
  }
  function send(S, st, n) { S.I.outM[n.id].forEach(e => { st.msg[e.id] = Math.min(CAP, (st.msg[e.id] || 0) + 1); }); }
  function consume(st, from) { (Array.isArray(from) ? from : from ? [from] : []).forEach(id => { st.tok[id] = Math.max(0, (st.tok[id] || 0) - 1); if (!st.tok[id]) delete st.tok[id]; }); }
  function fire(S, st0, mv) {
    const st = cp(st0), I = S.I, n = I.by[mv.n];
    consume(st, mv.from);
    if (mv.msgIn && st.msg[mv.msgIn]) { st.msg[mv.msgIn] = Math.max(0, st.msg[mv.msgIn] - 1); if (!st.msg[mv.msgIn]) delete st.msg[mv.msgIn]; }
    const outs = id => I.outS[id].map(e => e.id);
    if (n.t === 'start') { st.started[n.id] = 1; outs(n.id).forEach(id => produce(S, st, id)); return st; }
    if (n.t === 'end') {
      st.ended[n.id] = Math.min(2, (st.ended[n.id] || 0) + 1);
      if (st.ended[n.id] > 1) st.flags['e:' + n.id] = 1;
      if (n.k === 'msg') send(S, st, n);
      if (n.k === 'terminate') Object.keys(st.tok).forEach(k => { const e = S.m.edges.find(x => x.id === k); const f = e && I.by[e.f]; if (f && S.scope[f.id] === S.scope[n.id]) delete st.tok[k]; });
      return st;
    }
    if (n.t === 'evb' && mv.via) {
      const e = S.m.edges.find(x => x.id === mv.via), t = I.by[e.to];
      outs(t.id).forEach(id => produce(S, st, id));
      send(S, st, t);
      return st;
    }
    if (mv.via) {
      const b = I.by[mv.via];
      outs(b.id).forEach(id => produce(S, st, id));
      if (b.ni) { outs(n.id).forEach(id => produce(S, st, id)); send(S, st, n); }
      return st;
    }
    (mv.pick || outs(n.id)).forEach(id => produce(S, st, id));
    if (['task', 'sub', 'call'].includes(n.t) || (n.t === 'ievent' && (n.k === 'msgT' || n.k === 'signalT'))) send(S, st, n);
    return st;
  }
  const key = st => JSON.stringify([Object.entries(st.tok).sort(), Object.entries(st.msg).sort(), Object.keys(st.started).sort(), Object.entries(st.ended).sort()]);
  const clean = st => Object.keys(st.tok).length === 0;

  /* Перебирает все достижимые состояния процесса. */
  function analyze(m) {
    const S = setup(m);
    const res = { states: 0, deadlock: null, multi: [], unbounded: false, truncated: false, completed: false };
    if (!S.flow.some(n => n.t === 'start')) return Object.assign(res, { skipped: true });
    const seen = new Set(), queue = [simInit()];
    const flagged = new Set();
    seen.add(key(queue[0]));
    while (queue.length) {
      const st = queue.shift();
      res.states++;
      Object.keys(st.flags).forEach(f => {
        if (flagged.has(f)) return;
        flagged.add(f);
        if (f === 'unb') res.unbounded = true;
        else if (f[0] === 'm') {
          const e = m.edges.find(x => x.id === f.slice(2)), t = e && S.I.by[e.to];
          if (t) res.multi.push({ node: t.id, msg: 'К элементу ' + name(t) + ' может прийти несколько токенов одновременно: он выполнится больше одного раза за один экземпляр процесса. Частая причина: параллельное ветвление (AND) соединено исключающим слиянием (XOR) или ветки сходятся без шлюза.' });
        } else if (f[0] === 'e') {
          const t = S.I.by[f.slice(2)];
          if (t) res.multi.push({ node: t.id, msg: 'Конечное событие ' + name(t) + ' может сработать дважды за один экземпляр процесса. Проверьте, чем сходятся параллельные ветки: если после AND-ветвления стоит XOR-слияние, процесс завершится повторно.' });
        }
      });
      const mv = moves(S, st);
      if (!mv.length) {
        if (clean(st)) { if (Object.keys(st.ended).length) res.completed = true; }
        else if (!res.deadlock) {
          const ids = Object.keys(st.tok);
          const e = m.edges.find(x => x.id === ids[0]), t = e && S.I.by[e.to];
          let why = '';
          if (t && t.t === 'and') why = ' Параллельный шлюз ждёт токены по всем входящим веткам, но некоторые ветки не будут выполнены (частая причина: исключающее ветвление XOR соединено параллельным слиянием AND).';
          else if (t && (S.I.inM[t.id].length)) why = ' Он ждёт сообщение, которое никто не отправляет.';
          res.deadlock = { node: t ? t.id : null, msg: 'Процесс может «зависнуть»: токен остаётся перед элементом ' + name(t) + ' и дальше не движется.' + why };
        }
        continue;
      }
      for (const mvv of mv) {
        const nx = fire(S, st, mvv);
        if (Object.keys(nx.tok).some(k => nx.tok[k] > CAP)) { res.unbounded = true; continue; }
        const k = key(nx);
        if (seen.has(k)) continue;
        if (seen.size >= STATE_LIMIT) { res.truncated = true; continue; }
        seen.add(k);
        queue.push(nx);
      }
    }
    return res;
  }

  /* ===== помощник для заданий: поиск элементов по названию и пути между ними ===== */
  function checker(m) {
    const I = B.idx(m), L = B.layout(m);
    const lab = n => (n.l || '').toLowerCase().replace(/ё/g, 'е');
    const find = (re, t) => m.nodes.filter(n => (!t || (Array.isArray(t) ? t.includes(n.t) : n.t === t)) && (!re || re.test(lab(n))));
    const reach = (a, b, kinds) => {
      const seen = new Set(), st = [a.id];
      while (st.length) {
        const id = st.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        (I.outS[id] || []).forEach(e => st.push(e.to));
        if (kinds !== 'noBnd') m.nodes.forEach(n => { if (n.t === 'bnd' && n.host === id) st.push(n.id); });
      }
      return seen.has(b.id) && a.id !== b.id;
    };
    const M = {
      m, I, L, find,
      count: (t, k) => m.nodes.filter(n => n.t === t && (!k || n.k === k)).length,
      has: (re, t) => find(re, t).length > 0,
      /* A достижим к B по потокам последовательности */
      path: (ra, rb, ta, tb) => find(ra, ta).some(a => find(rb, tb).some(b => reach(a, b))),
      /* A раньше B и не наоборот (без цикла) */
      before: (ra, rb) => find(ra).some(a => find(rb).some(b => reach(a, b) && !reach(b, a))),
      /* A и B не зависят друг от друга и расходятся из общего параллельного шлюза */
      parallel: (ra, rb) => find(ra).some(a => find(rb).some(b => a.id !== b.id && !reach(a, b) && !reach(b, a) &&
        m.nodes.some(g => g.t === 'and' && I.outS[g.id].length > 1 && reach(g, a) && reach(g, b)))),
      lane: (re, laneRe) => find(re).some(n => { const l = B.laneOf(L, n); return l && laneRe.test(l.name.toLowerCase().replace(/ё/g, 'е')); }),
      pool: (re, poolRe) => find(re).some(n => { const p = L.poolOfId(B.poolOf(L, n)); return p && poolRe.test(p.name.toLowerCase().replace(/ё/g, 'е')); }),
      gate: (t, minOut) => m.nodes.filter(n => n.t === t && I.outS[n.id].length >= (minOut || 2)),
      /* ветка с подписью, подходящей под re, ведёт к элементу с названием rb */
      branch: (gt, rl, rb) => m.nodes.filter(n => n.t === gt).some(g => I.outS[g.id].some(e => rl.test(lab({ l: e.l })) && find(rb).some(b => I.by[e.to] === b || reach(I.by[e.to], b)))),
      msg: (ra, rb) => m.edges.some(e => {
        const ends = (id, re) => (I.by[id] && re.test(lab(I.by[id]))) || (I.pools[id] && re.test(lab({ l: I.pools[id].name })));
        return e.k === 'msg' && ends(e.f, ra) && ends(e.to, rb);
      }),
      /* число узлов с несколькими входами (слияние) */
      join: t => m.nodes.filter(n => n.t === t && I.inS[n.id].length >= 2),
      kind: (t, k) => m.nodes.filter(n => n.t === t && n.k === k).length,
      bndTo: rb => find(null, 'bnd').some(b => find(rb).some(t => reach(b, t))),
      strict: () => lint(m).filter(x => x.lvl !== 'tip').length === 0,
      msgCount: () => m.edges.filter(e => e.k === 'msg').length,
      host: (rt, bk) => m.nodes.some(n => n.t === 'bnd' && (!bk || n.k === bk) && I.by[n.host] && rt.test(lab(I.by[n.host]))),
      loop: () => m.nodes.some(n => B.isFlow(n.t) && I.outS[n.id].some(e => { const t = I.by[e.to]; return t && (t.id === n.id || reach(t, n)); })),
      lint: () => lint(m),
      clean: () => counts(lint(m)).error === 0
    };
    return M;
  }

  /* ===== экспорт в BPMN 2.0 XML (открывается в bpmn.io, Camunda Modeler, draw.io) ===== */
  const xa = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TASKTAG = { none: 'task', user: 'userTask', service: 'serviceTask', manual: 'manualTask', script: 'scriptTask', send: 'sendTask', receive: 'receiveTask', rule: 'businessRuleTask' };
  const EVDEF = { msg: 'messageEventDefinition', msgT: 'messageEventDefinition', timer: 'timerEventDefinition', error: 'errorEventDefinition', signal: 'signalEventDefinition', signalT: 'signalEventDefinition', terminate: 'terminateEventDefinition', cond: 'conditionalEventDefinition', link: 'linkEventDefinition', linkT: 'linkEventDefinition' };
  function evdef(n) {
    const d = EVDEF[n.k];
    if (!d) return '';
    if (d === 'conditionalEventDefinition') return '<bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression" /></bpmn:conditionalEventDefinition>';
    if (d === 'linkEventDefinition') return `<bpmn:linkEventDefinition name="${xa(n.l || 'Ссылка')}" />`;
    return `<bpmn:${d} />`;
  }
  function toXml(m) {
    B.fixBnd(m);
    const L = B.layout(m), I = B.idx(m);
    const poolOfNode = n => (m.pools.length ? B.poolOf(L, n) : '*');
    const procId = p => 'Process_' + (p === '*' ? 'main' : p);
    const flowEl = n => {
      const nm = xa(n.l);
      const ins = I.inS[n.id].map(e => `<bpmn:incoming>${e.id}</bpmn:incoming>`).join(''), outs = I.outS[n.id].map(e => `<bpmn:outgoing>${e.id}</bpmn:outgoing>`).join('');
      const io = ins + outs;
      switch (n.t) {
        case 'start': return `<bpmn:startEvent id="${n.id}" name="${nm}">${io}${evdef(n)}</bpmn:startEvent>`;
        case 'end': return `<bpmn:endEvent id="${n.id}" name="${nm}">${io}${evdef(n)}</bpmn:endEvent>`;
        case 'ievent': { const thr = /T$/.test(n.k || ''); const tag = thr ? 'intermediateThrowEvent' : 'intermediateCatchEvent'; return `<bpmn:${tag} id="${n.id}" name="${nm}">${io}${evdef(n)}</bpmn:${tag}>`; }
        case 'bnd': return `<bpmn:boundaryEvent id="${n.id}" name="${nm}" attachedToRef="${n.host}"${n.ni ? ' cancelActivity="false"' : ''}>${io}${evdef(n)}</bpmn:boundaryEvent>`;
        case 'task': return `<bpmn:${TASKTAG[n.k || 'none']} id="${n.id}" name="${nm}"${defAttr(n)}>${io}</bpmn:${TASKTAG[n.k || 'none']}>`;
        case 'sub': return `<bpmn:subProcess id="${n.id}" name="${nm}"${defAttr(n)}>${io}</bpmn:subProcess>`;
        case 'call': return `<bpmn:callActivity id="${n.id}" name="${nm}"${defAttr(n)}>${io}</bpmn:callActivity>`;
        case 'xor': return `<bpmn:exclusiveGateway id="${n.id}" name="${nm}"${defAttr(n)}>${io}</bpmn:exclusiveGateway>`;
        case 'and': return `<bpmn:parallelGateway id="${n.id}" name="${nm}">${io}</bpmn:parallelGateway>`;
        case 'or': return `<bpmn:inclusiveGateway id="${n.id}" name="${nm}"${defAttr(n)}>${io}</bpmn:inclusiveGateway>`;
        case 'evb': return `<bpmn:eventBasedGateway id="${n.id}" name="${nm}">${io}</bpmn:eventBasedGateway>`;
      }
      return '';
    };
    function defAttr(n) { const d = I.outS[n.id].find(e => e.d); return d ? ` default="${d.id}"` : ''; }
    const procBody = scope => {
      const nodes = m.nodes.filter(n => poolOfNode(n) === scope || (!poolOfNode(n) && scope === (m.pools.find(p => !p.bb) || {}).id));
      const ids = new Set(nodes.map(n => n.id));
      let s = '';
      const pool = m.pools.find(p => p.id === scope);
      if (pool && pool.lanes.length && (pool.lanes.length > 1 || pool.lanes[0].name)) {
        s += '<bpmn:laneSet id="LaneSet_' + pool.id + '">' + pool.lanes.map(l => {
          const inLane = nodes.filter(n => B.isFlow(n.t) && n.t !== 'bnd' || ['data', 'store'].includes(n.t)).filter(n => { const ll = B.laneOf(L, n); return ll && ll.id === l.id; });
          return `<bpmn:lane id="${l.id}" name="${xa(l.name)}">` + inLane.map(n => `<bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`).join('') + '</bpmn:lane>';
        }).join('') + '</bpmn:laneSet>';
      }
      nodes.forEach(n => {
        if (B.isFlow(n.t)) s += flowEl(n);
        else if (n.t === 'data') s += `<bpmn:dataObjectReference id="${n.id}" name="${xa(n.l)}" dataObjectRef="DataObject_${n.id}" /><bpmn:dataObject id="DataObject_${n.id}" />`;
        else if (n.t === 'store') s += `<bpmn:dataStoreReference id="${n.id}" name="${xa(n.l)}" />`;
        else if (n.t === 'note') s += `<bpmn:textAnnotation id="${n.id}"><bpmn:text>${xa(n.l)}</bpmn:text></bpmn:textAnnotation>`;
      });
      m.edges.forEach(e => {
        if (e.k === 'msg') return;
        if (!ids.has(e.f) || !ids.has(e.to)) return;
        if (e.k === 'seq') s += `<bpmn:sequenceFlow id="${e.id}" name="${xa(e.l)}" sourceRef="${e.f}" targetRef="${e.to}" />`;
        else s += `<bpmn:association id="${e.id}" sourceRef="${e.f}" targetRef="${e.to}" />`;
      });
      return s;
    };
    const ref = id => I.pools[id] ? 'Participant_' + id : id;
    let body = '';
    if (m.pools.length) {
      body += '<bpmn:collaboration id="Collaboration_1">' + m.pools.map(p => `<bpmn:participant id="Participant_${p.id}" name="${xa(p.name)}"${p.bb ? '' : ` processRef="${procId(p.id)}"`} />`).join('') +
        m.edges.filter(e => e.k === 'msg').map(e => `<bpmn:messageFlow id="${e.id}" name="${xa(e.l)}" sourceRef="${ref(e.f)}" targetRef="${ref(e.to)}" />`).join('') + '</bpmn:collaboration>';
      m.pools.filter(p => !p.bb).forEach(p => { body += `<bpmn:process id="${procId(p.id)}" isExecutable="false">${procBody(p.id)}</bpmn:process>`; });
    } else body += `<bpmn:process id="${procId('*')}" isExecutable="false">${procBody('*')}</bpmn:process>`;
    /* графическая часть */
    let di = '';
    const rootId = m.pools.length ? 'Collaboration_1' : procId('*');
    L.pools.forEach(p => {
      const W = Math.max(600, ...m.nodes.map(n => n.x + B.halfW(n) + 40));
      di += `<bpmndi:BPMNShape id="Shape_P_${p.id}" bpmnElement="Participant_${p.id}" isHorizontal="true"><dc:Bounds x="0" y="${p.y}" width="${W}" height="${p.h}" /></bpmndi:BPMNShape>`;
      p.lanes.forEach(l => { if (p.lanes.length > 1 || l.name) di += `<bpmndi:BPMNShape id="Shape_L_${l.id}" bpmnElement="${l.id}" isHorizontal="true"><dc:Bounds x="${32}" y="${l.y}" width="${W - 32}" height="${l.h}" /></bpmndi:BPMNShape>`; });
    });
    m.nodes.forEach(n => {
      const [w, h] = B.SZ[n.t];
      const ex = ['xor', 'and', 'or', 'evb'].includes(n.t) ? ' isMarkerVisible="true"' : '';
      di += `<bpmndi:BPMNShape id="Shape_${n.id}" bpmnElement="${n.id}"${n.t === 'xor' ? ex : ''}><dc:Bounds x="${n.x - w / 2}" y="${n.y - h / 2}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
    });
    m.edges.forEach(e => {
      const pts = B.route(m, L, I, e);
      if (pts.length) di += `<bpmndi:BPMNEdge id="Edge_${e.id}" bpmnElement="${e.id}">` + pts.map(p => `<di:waypoint x="${p[0]}" y="${p[1]}" />`).join('') + '</bpmndi:BPMNEdge>';
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">\n${body}\n<bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${rootId}">${di}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</bpmn:definitions>\n`;
  }

  Object.assign(B, { lint, counts, setup, simInit, moves, fire, analyze, checker, toXml });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BPMN;
