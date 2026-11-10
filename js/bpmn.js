'use strict';
/* BPMN: модель схемы, разбор краткой записи, раскладка, маршрутизация потоков, рисование в SVG и операции редактора.
   Проверки стиля, симуляция токенов и экспорт лежат в bpmn-check.js. Файл не обращается к DOM. */

const BPMN = (function () {
  /* ===== размеры и справочники ===== */
  const SZ = {
    start: [36, 36], end: [36, 36], ievent: [36, 36], bnd: [28, 28],
    task: [120, 64], sub: [128, 72], call: [120, 64],
    xor: [44, 44], and: [44, 44], or: [44, 44], evb: [44, 44],
    data: [34, 42], store: [44, 42], note: [130, 46]
  };
  const FLOW_TYPES = ['start', 'end', 'ievent', 'bnd', 'task', 'sub', 'call', 'xor', 'and', 'or', 'evb'];
  const GATES = ['xor', 'and', 'or', 'evb'];
  const KINDS = {
    start: ['none', 'msg', 'timer', 'signal', 'cond'],
    end: ['none', 'msg', 'error', 'signal', 'terminate'],
    ievent: ['timer', 'msg', 'msgT', 'signal', 'signalT', 'cond', 'link', 'linkT'],
    bnd: ['timer', 'msg', 'error', 'signal'],
    task: ['none', 'user', 'service', 'manual', 'script', 'send', 'receive', 'rule']
  };
  const KIND_RU = {
    none: 'Обычное', msg: 'Сообщение (получение)', msgT: 'Сообщение (отправка)', timer: 'Таймер', signal: 'Сигнал (получение)', signalT: 'Сигнал (отправка)',
    cond: 'Условие', link: 'Ссылка (приём)', linkT: 'Ссылка (передача)', error: 'Ошибка', terminate: 'Завершение всего процесса',
    user: 'Пользовательская', service: 'Сервисная', manual: 'Ручная', script: 'Скрипт', send: 'Отправка', receive: 'Получение', rule: 'Бизнес-правило'
  };
  const TYPE_RU = {
    start: 'Начальное событие', end: 'Конечное событие', ievent: 'Промежуточное событие', bnd: 'Граничное событие',
    task: 'Задача', sub: 'Подпроцесс', call: 'Вызов процесса', xor: 'Исключающий шлюз (XOR)', and: 'Параллельный шлюз (AND)',
    or: 'Включающий шлюз (OR)', evb: 'Шлюз по событиям', data: 'Объект данных', store: 'Хранилище данных', note: 'Комментарий'
  };
  const LANE_H = 140, POOL_GAP = 26, HEAD_W = 32, BB_H = 84, TOP = 8;
  const COLW = 140, ROWH = 100;
  const LIM = { nodes: 150, edges: 300, pools: 6, lanes: 12, label: 160, name: 80 };

  const isFlow = t => FLOW_TYPES.includes(t);
  const isGate = t => GATES.includes(t);
  const halfW = n => SZ[n.t][0] / 2;
  const halfH = n => SZ[n.t][1] / 2;

  /* ===== модель ===== */
  function empty() { return { pools: [], nodes: [], edges: [], seq: 0 }; }
  function copy(m) { return JSON.parse(JSON.stringify(m)); }
  function uid(m, p) {
    const used = new Set([].concat(m.nodes.map(n => n.id), m.edges.map(e => e.id), m.pools.map(x => x.id), [].concat(...m.pools.map(x => x.lanes.map(l => l.id)))));
    let id;
    do { id = p + (++m.seq); } while (used.has(id));
    return id;
  }
  function idx(m) {
    const by = {}, pools = {};
    m.nodes.forEach(n => { by[n.id] = n; });
    m.pools.forEach(p => { pools[p.id] = p; });
    const I = { by, pools, outS: {}, inS: {}, outM: {}, inM: {}, outA: {}, inA: {} };
    Object.keys(by).concat(Object.keys(pools)).forEach(id => { I.outS[id] = []; I.inS[id] = []; I.outM[id] = []; I.inM[id] = []; I.outA[id] = []; I.inA[id] = []; });
    m.edges.forEach(e => {
      if (!(e.f in I.outS) || !(e.to in I.inS)) return;
      const o = e.k === 'msg' ? I.outM : e.k === 'assoc' ? I.outA : I.outS;
      const i = e.k === 'msg' ? I.inM : e.k === 'assoc' ? I.inA : I.inS;
      o[e.f].push(e); i[e.to].push(e);
    });
    return I;
  }

  /* ===== раскладка пулов и дорожек ===== */
  function layout(m) {
    let y = TOP;
    const lanes = [], pools = [];
    m.pools.forEach((p, pi) => {
      const y0 = y, pl = { id: p.id, name: p.name, y: y0, bb: !!p.bb, pi, lanes: [] };
      if (p.bb) y += BB_H;
      else p.lanes.forEach((l, li) => {
        const h = l.h || LANE_H;
        const e = { pool: p.id, id: l.id, name: l.name, y, h, pi, li };
        lanes.push(e); pl.lanes.push(e); y += h;
      });
      pl.h = y - y0;
      pools.push(pl);
      y += POOL_GAP;
    });
    const L = { lanes, pools, bottom: m.pools.length ? y - POOL_GAP : 0 };
    L.laneAt = (px, py) => lanes.find(l => py >= l.y && py < l.y + l.h) || null;
    L.poolOfId = id => pools.find(p => p.id === id) || null;
    return L;
  }
  function laneOf(L, n) { return L.laneAt(n.x, n.y); }
  function poolOf(L, n) {
    const l = L.laneAt(n.x, n.y);
    return l ? l.pool : null;
  }

  /* Положение граничных событий вычисляется по задаче, к которой они прикреплены. */
  function fixBnd(m) {
    const by = {}, cnt = {};
    m.nodes.forEach(n => { by[n.id] = n; });
    m.nodes.forEach(n => {
      if (n.t !== 'bnd') return;
      const h = by[n.host];
      if (!h || !SZ[h.t]) return;
      const i = cnt[h.id] = (cnt[h.id] || 0) + 1;
      n.x = Math.min(h.x - halfW(h) + 24 + (i - 1) * 34, h.x + halfW(h) - 14);
      n.y = h.y + halfH(h);
    });
  }

  /* ===== разбор краткой записи схемы =====
     P Название: Дорожка 1 | Дорожка 2(160)       пул с дорожками (в скобках высота)
     P Название!                                   пул-«чёрный ящик»
     N id тип[:вид] колонка,строка[,сдвиг] "Название"
     B id задача вид "Название" [ni]               граничное событие
     E от до ["Название"] [msg|assoc|def]          поток
     Типы: s e t sub call x a o v i d db n. Строка это номер дорожки по порядку (без пулов: номер ряда). */
  const TMAP = { s: 'start', e: 'end', t: 'task', sub: 'sub', call: 'call', x: 'xor', a: 'and', o: 'or', v: 'evb', i: 'ievent', d: 'data', db: 'store', n: 'note' };
  function tokens(line) {
    const out = [], re = /"([^"]*)"|(\S+)/g;
    let r;
    while ((r = re.exec(line))) out.push(r[1] !== undefined ? { q: r[1] } : r[2]);
    return out;
  }
  function parseDsl(text) {
    const m = empty();
    const rows = [];
    const placed = [];
    String(text).split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line || line[0] === '#') return;
      if (line[0] === 'P' && /^P\s/.test(line)) {
        const body = line.slice(1).trim();
        const bb = /!\s*$/.test(body);
        const pi = m.pools.length + 1;
        const [name, rest] = bb ? [body.replace(/!\s*$/, ''), ''] : (body.includes(':') ? [body.slice(0, body.indexOf(':')), body.slice(body.indexOf(':') + 1)] : [body, '']);
        const pool = { id: 'p' + pi, name: name.trim(), lanes: [], bb };
        if (!bb) {
          const names = rest.trim() ? rest.split('|').map(s => s.trim()) : [''];
          names.forEach((s, li) => {
            const mm = /^(.*?)\s*\((\d+)\)$/.exec(s);
            pool.lanes.push({ id: 'l' + pi + '_' + (li + 1), name: mm ? mm[1] : s, h: mm ? +mm[2] : LANE_H });
          });
        }
        m.pools.push(pool);
        return;
      }
      const t = tokens(line);
      const cmd = t[0];
      if (cmd === 'N' || cmd === 'B') {
        const label = t.find((x, i) => i > 2 && typeof x === 'object');
        if (cmd === 'N') {
          const [typ, kind] = String(t[2]).split(':');
          const pos = String(t[3]).split(',').map(Number);
          const n = { id: t[1], t: TMAP[typ] || typ, k: kind || undefined, l: label ? label.q : '', x: 0, y: 0 };
          if (!SZ[n.t]) throw new Error('DSL: неизвестный тип ' + typ);
          placed.push({ n, col: pos[0], row: pos[1] || 0, dy: pos[2] || 0 });
          m.nodes.push(n);
        } else {
          const n = { id: t[1], t: 'bnd', host: t[2], k: t[3], l: label ? label.q : '', x: 0, y: 0 };
          if (t.includes('ni')) n.ni = true;
          m.nodes.push(n);
        }
      } else if (cmd === 'E') {
        const label = t.find((x, i) => i > 2 && typeof x === 'object');
        const e = { id: 'fl' + (m.edges.length + 1), f: t[1], to: t[2], l: label ? label.q : '', k: 'seq' };
        if (t.includes('msg')) e.k = 'msg';
        if (t.includes('assoc')) e.k = 'assoc';
        if (t.includes('def')) e.d = true;
        m.edges.push(e);
      }
    });
    const L = layout(m);
    const x0 = m.pools.length ? 118 : 60;
    placed.forEach(p => {
      p.n.x = x0 + p.col * COLW;
      if (m.pools.length) {
        const lane = L.lanes[Math.floor(p.row)];
        p.n.y = lane ? lane.y + lane.h / 2 + p.dy : 60 + p.dy;
      } else p.n.y = 70 + p.row * ROWH + p.dy;
    });
    fixBnd(m);
    m.seq = 1000;
    return m;
  }

  /* ===== сериализация и очистка ===== */
  const num = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
  const str = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : '';
  const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;
  function toJson(m) { return JSON.stringify({ pools: m.pools, nodes: m.nodes, edges: m.edges, seq: m.seq }); }
  /* Возвращает чистую модель или null. Лишние поля, неизвестные типы и висячие ссылки отбрасываются. */
  function fromJson(text) {
    let o;
    try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    const m = empty();
    m.seq = num(o.seq, 0, 100000, 0);
    const ids = new Set();
    const take = id => { if (typeof id !== 'string' || !ID_RE.test(id) || ids.has(id)) return false; ids.add(id); return true; };
    (Array.isArray(o.pools) ? o.pools : []).slice(0, LIM.pools).forEach(p => {
      if (!p || !take(p.id)) return;
      const pool = { id: p.id, name: str(p.name, LIM.name), lanes: [], bb: !!p.bb };
      if (!pool.bb) {
        (Array.isArray(p.lanes) ? p.lanes : []).slice(0, LIM.lanes).forEach(l => {
          if (l && take(l.id)) pool.lanes.push({ id: l.id, name: str(l.name, LIM.name), h: num(l.h, 80, 400, LANE_H) });
        });
        if (!pool.lanes.length) return;
      }
      m.pools.push(pool);
    });
    (Array.isArray(o.nodes) ? o.nodes : []).slice(0, LIM.nodes).forEach(n => {
      if (!n || !SZ[n.t] || !take(n.id)) return;
      const c = { id: n.id, t: n.t, l: str(n.l, LIM.label), x: num(n.x, -500, 8000, 100), y: num(n.y, -500, 8000, 100) };
      if (KINDS[n.t] && KINDS[n.t].includes(n.k)) c.k = n.k;
      if (n.t === 'bnd') { c.host = typeof n.host === 'string' ? n.host : ''; if (n.ni) c.ni = true; }
      m.nodes.push(c);
    });
    const have = new Set(m.nodes.map(n => n.id));
    m.nodes = m.nodes.filter(n => n.t !== 'bnd' || (have.has(n.host) && n.host !== n.id));
    const ends = new Set(m.nodes.map(n => n.id).concat(m.pools.map(p => p.id)));
    (Array.isArray(o.edges) ? o.edges : []).slice(0, LIM.edges).forEach(e => {
      if (!e || !take(e.id) || !ends.has(e.f) || !ends.has(e.to) || e.f === e.to) return;
      const c = { id: e.id, f: e.f, to: e.to, l: str(e.l, LIM.label), k: e.k === 'msg' || e.k === 'assoc' ? e.k : 'seq' };
      if (e.d) c.d = true;
      m.edges.push(c);
    });
    fixBnd(m);
    return m;
  }

  /* ===== маршрутизация потоков ===== */
  function boxOf(m, L, I, id, other) {
    const n = I.by[id];
    if (n) return { cx: n.x, cy: n.y, hw: halfW(n), hh: halfH(n), n };
    const p = L.poolOfId(id);
    if (p) return { cx: other ? other.cx : 100, cy: p.y + p.h / 2, hw: 0, hh: p.h / 2, pool: true };
    return null;
  }
  function route(m, L, I, e) {
    const a0 = boxOf(m, L, I, e.f), b0 = boxOf(m, L, I, e.to);
    if (!a0 || !b0) return [];
    const a = a0.pool ? boxOf(m, L, I, e.f, b0) : a0, b = b0.pool ? boxOf(m, L, I, e.to, a0) : b0;
    const sx = a.cx, sy = a.cy, tx = b.cx, ty = b.cy;
    const P = (x, y) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    if (e.k === 'msg' || a.pool || b.pool) {
      const down = ty > sy;
      const y1 = sy + (down ? a.hh : -a.hh), y2 = ty + (down ? -b.hh : b.hh);
      if (Math.abs(sx - tx) < 2) return [P(sx, y1), P(tx, y2)];
      const my = (y1 + y2) / 2;
      return [P(sx, y1), P(sx, my), P(tx, my), P(tx, y2)];
    }
    const sn = a.n, tn = b.n;
    const right = tx - b.hw > sx + a.hw + 8;
    const vertFirst = sn && (isGate(sn.t) || sn.t === 'bnd');
    const horizFirstIntoGate = tn && isGate(tn.t);
    if (right) {
      const ex = sx + a.hw, nx = tx - b.hw;
      if (Math.abs(sy - ty) < 2) return [P(ex, sy), P(nx, ty)];
      if (vertFirst && Math.abs(sy - ty) > 8) {
        const y1 = sy + (ty > sy ? a.hh : -a.hh);
        return [P(sx, y1), P(sx, ty), P(nx, ty)];
      }
      if (horizFirstIntoGate && !vertFirst && Math.abs(sy - ty) > 8) {
        const y2 = ty + (ty > sy ? -b.hh : b.hh);
        return [P(ex, sy), P(tx, sy), P(tx, y2)];
      }
      const mx = (ex + nx) / 2;
      return [P(ex, sy), P(mx, sy), P(mx, ty), P(nx, ty)];
    }
    if (Math.abs(sx - tx) <= a.hw + b.hw + 8 && Math.abs(sy - ty) > 2) {
      const down = ty > sy;
      const y1 = sy + (down ? a.hh : -a.hh), y2 = ty + (down ? -b.hh : b.hh);
      if (Math.abs(sx - tx) < 2) return [P(sx, y1), P(tx, y2)];
      const my = (y1 + y2) / 2;
      return [P(sx, y1), P(sx, my), P(tx, my), P(tx, y2)];
    }
    /* Возврат назад. Если цель ниже, обходим сверху, иначе снизу. */
    if (ty > sy + 8) {
      const yt = Math.min(sy - a.hh, ty - b.hh) - 24;
      return [P(sx, sy - a.hh), P(sx, yt), P(tx, yt), P(tx, ty - b.hh)];
    }
    const yb = Math.max(sy + a.hh, ty + b.hh) + 30;
    return [P(sx, sy + a.hh), P(sx, yb), P(tx, yb), P(tx, ty + b.hh)];
  }
  function polyLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
  function pointAt(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d <= l || i === pts.length - 1) { const k = l ? Math.min(1, d / l) : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]; }
      d -= l;
    }
    return pts[0] || [0, 0];
  }

  /* ===== рисование ===== */
  function wrap(s, max, maxLines) {
    const words = String(s || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach(w => {
      while (w.length > max) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, max)); w = w.slice(max); }
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) { const k = lines.slice(0, maxLines); k[maxLines - 1] = k[maxLines - 1].replace(/.{0,2}$/, '') + '…'; return k; }
    return lines;
  }
  const X = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function text(lines, x, y, cls, lh, anchor) {
    if (!lines.length) return '';
    const y0 = y - (lines.length - 1) * lh / 2;
    return `<text class="${cls}" text-anchor="${anchor || 'middle'}" x="${x}">` + lines.map((s, i) => `<tspan x="${x}" y="${(y0 + i * lh).toFixed(1)}" dy=".34em">${X(s)}</tspan>`).join('') + '</text>';
  }
  function icon(k) {
    switch (k) {
      case 'msg': case 'receive': return '<rect x="-8" y="-5.5" width="16" height="11" rx="1" class="ic"/><path d="M-8,-5.5 L0,1 L8,-5.5" class="ic"/>';
      case 'msgT': case 'send': return '<rect x="-8" y="-5.5" width="16" height="11" rx="1" class="ic ic-f"/><path d="M-8,-5.5 L0,1 L8,-5.5" class="ic ic-s"/>';
      case 'timer': return '<circle r="8.5" class="ic"/><path d="M0,-5.5 V0 L4,2.5 M0,-8.5 V-7 M0,7 V8.5 M-8.5,0 H-7 M7,0 H8.5" class="ic"/>';
      case 'error': return '<path d="M-6.5,7 L-3,-2 L1,2 L6.5,-8 L3,3 L-1,-1 Z" class="ic"/>';
      case 'errorT': return '<path d="M-6.5,7 L-3,-2 L1,2 L6.5,-8 L3,3 L-1,-1 Z" class="ic ic-f"/>';
      case 'signal': return '<path d="M0,-8 L8,7 L-8,7 Z" class="ic"/>';
      case 'signalT': return '<path d="M0,-8 L8,7 L-8,7 Z" class="ic ic-f"/>';
      case 'cond': return '<rect x="-6.5" y="-8" width="13" height="16" class="ic"/><path d="M-3.5,-4 H3.5 M-3.5,-1 H3.5 M-3.5,2 H3.5 M-3.5,5 H3.5" class="ic"/>';
      case 'link': return '<path d="M-8,-3 H1 V-7 L8,0 L1,7 V3 H-8 Z" class="ic"/>';
      case 'linkT': return '<path d="M-8,-3 H1 V-7 L8,0 L1,7 V3 H-8 Z" class="ic ic-f"/>';
      case 'terminate': return '<circle r="9" class="ic ic-f"/>';
      default: return '';
    }
  }
  function taskIcon(k) {
    switch (k) {
      case 'user': return '<circle cx="0" cy="-3.5" r="3.2" class="ic"/><path d="M-6,7 C-6,0.5 6,0.5 6,7 Z" class="ic"/>';
      case 'service': return '<circle r="2.8" class="ic"/><circle r="5.8" class="ic" stroke-dasharray="2.6 2.1"/>';
      case 'manual': return '<path d="M-6,5 V-2 C-6,-4 -3,-4 -3,-2 V-6 C-3,-8 0,-8 0,-6 V-7 C0,-9 3,-9 3,-7 V-5 C3,-7 6,-7 6,-5 V3 C6,6 4,7 0,7 H-3 C-5,7 -6,6 -6,5 Z" class="ic"/>';
      case 'script': return '<path d="M-5,-7 H5 V6 H-5 Z" class="ic"/><path d="M-3,-3.5 H3 M-3,0 H3 M-3,3.5 H1" class="ic"/>';
      case 'send': case 'receive': return icon(k);
      case 'rule': return '<rect x="-7" y="-6" width="14" height="12" class="ic"/><path d="M-7,-2 H7 M-7,2 H7 M-1,-6 V6" class="ic"/>';
      default: return '';
    }
  }
  /* Название шлюза стоит над ромбом слева от вертикальных веток. */
  function gateLabel(l) {
    const lines = wrap(l, 22, 3);
    return text(lines, -4, -39 - (lines.length - 1) * 6.5, 'bp-gt', 13, 'end');
  }
  function nodeSvg(n, o) {
    const [w, h] = SZ[n.t], hw = w / 2, hh = h / 2;
    const cls = ['bp-n'];
    if (o.sel === n.id) cls.push('sel');
    if (o.marks && o.marks[n.id]) cls.push('mk-' + o.marks[n.id]);
    let g = '', lab = '';
    const k = n.k || (n.t === 'task' ? 'none' : '');
    switch (n.t) {
      case 'start': g = `<circle r="18" class="bp-sh bp-thin"/><g transform="scale(.82)">${icon(k)}</g>`; lab = text(wrap(n.l, 18, 3), 0, 18 + 14, 'bp-ev', 13); break;
      case 'end': g = `<circle r="18" class="bp-sh bp-thick"/><g transform="scale(.82)">${icon(k === 'msg' ? 'msgT' : k === 'signal' ? 'signalT' : k === 'error' ? 'errorT' : k)}</g>`; lab = text(wrap(n.l, 18, 3), 0, 18 + 14, 'bp-ev', 13); break;
      case 'ievent': g = `<circle r="18" class="bp-sh bp-thin"/><circle r="14.2" class="bp-ln"/><g transform="scale(.82)">${icon(k)}</g>`; lab = text(wrap(n.l, 18, 3), 0, 18 + 14, 'bp-ev', 13); break;
      case 'bnd': g = `<circle r="14" class="bp-sh bp-thin${n.ni ? ' bp-dash' : ''}"/><circle r="11" class="bp-ln${n.ni ? ' bp-dash' : ''}"/><g transform="scale(.62)">${icon(k)}</g>`; lab = text(wrap(n.l, 15, 3), 18, 22, 'bp-ev', 12, 'start'); break;
      case 'task': case 'call':
        g = `<rect x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="10" class="bp-sh${n.t === 'call' ? ' bp-thick' : ''}"/>`;
        if (n.t === 'call') g += `<g transform="translate(0,${hh - 9})"><rect x="-7" y="-7" width="14" height="14" class="bp-ln"/><path d="M-4,0 H4 M0,-4 V4" class="bp-ln"/></g>`;
        if (taskIcon(k)) g += `<g transform="translate(${-hw + 14},${-hh + 14}) scale(.95)">${taskIcon(k)}</g>`;
        lab = text(wrap(n.l, 17, 4), 0, 0, 'bp-tk', 14.2);
        break;
      case 'sub':
        g = `<rect x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="10" class="bp-sh"/><g transform="translate(0,${hh - 10})"><rect x="-7" y="-7" width="14" height="14" class="bp-ln"/><path d="M-4,0 H4 M0,-4 V4" class="bp-ln"/></g>`;
        lab = text(wrap(n.l, 18, 3), 0, -6, 'bp-tk', 14.2);
        break;
      case 'xor': g = '<path d="M0,-22 L22,0 L0,22 L-22,0 Z" class="bp-sh"/><path d="M-8,-8 L8,8 M8,-8 L-8,8" class="bp-ln bp-bold"/>'; lab = gateLabel(n.l); break;
      case 'and': g = '<path d="M0,-22 L22,0 L0,22 L-22,0 Z" class="bp-sh"/><path d="M0,-11 V11 M-11,0 H11" class="bp-ln bp-bold"/>'; lab = gateLabel(n.l); break;
      case 'or': g = '<path d="M0,-22 L22,0 L0,22 L-22,0 Z" class="bp-sh"/><circle r="11" class="bp-ln bp-bold"/>'; lab = gateLabel(n.l); break;
      case 'evb': g = '<path d="M0,-22 L22,0 L0,22 L-22,0 Z" class="bp-sh"/><circle r="11.5" class="bp-ln"/><circle r="8.6" class="bp-ln"/><path d="M0,-5.5 L5.2,-1.7 L3.2,4.4 H-3.2 L-5.2,-1.7 Z" class="bp-ln"/>'; lab = gateLabel(n.l); break;
      case 'data': g = '<path d="M-13,-19 H4 L13,-10 V19 H-13 Z" class="bp-sh"/><path d="M4,-19 V-10 H13" class="bp-ln"/>'; lab = text(wrap(n.l, 18, 3), 0, 21 + 12, 'bp-ev', 13); break;
      case 'store': g = '<path d="M-20,-13 C-20,-22 20,-22 20,-13 V14 C20,23 -20,23 -20,14 Z" class="bp-sh"/><path d="M-20,-13 C-20,-4 20,-4 20,-13" class="bp-ln"/>'; lab = text(wrap(n.l, 18, 3), 0, 23 + 12, 'bp-ev', 13); break;
      case 'note': g = `<rect x="${-hw}" y="${-hh}" width="${w}" height="${h}" class="bp-hit"/><path d="M${-hw + 12},${-hh} H${-hw} V${hh} H${-hw + 12}" class="bp-ln"/>`; lab = text(wrap(n.l, 19, 3), -hw + 8, 0, 'bp-nt', 13.5, 'start'); break;
    }
    const halo = o.sel === n.id ? `<rect x="${-hw - 5}" y="${-hh - 5}" width="${w + 10}" height="${h + 10}" rx="9" class="bp-halo"/>` : '';
    return `<g class="${cls.join(' ')}" data-id="${n.id}" transform="translate(${n.x},${n.y})">${halo}<rect x="${-hw - 3}" y="${-hh - 3}" width="${w + 6}" height="${h + 6}" class="bp-hit"/>${g}${lab}</g>`;
  }

  const CSS = `
.bp-svg{font-family:"IBM Plex Sans",system-ui,Arial,sans-serif;display:block}
.bp-svg .bp-lane{fill:var(--bp-lane);stroke:var(--bp-line);stroke-width:1.2}
.bp-svg .bp-head{fill:var(--bp-head);stroke:var(--bp-line);stroke-width:1.2}
.bp-svg .bp-pl{fill:var(--bp-ink);font-size:12.5px;font-weight:600}
.bp-svg .bp-ll{fill:var(--bp-ink);font-size:12px}
.bp-svg .bp-sh{fill:var(--bp-fill);stroke:var(--bp-line);stroke-width:1.7}
.bp-svg .bp-thin{stroke-width:1.7}.bp-svg .bp-thick{stroke-width:4.2}
.bp-svg .bp-ln{fill:none;stroke:var(--bp-line);stroke-width:1.5}
.bp-svg .bp-bold{stroke-width:3.2}
.bp-svg .bp-dash{stroke-dasharray:4 3}
.bp-svg .ic{fill:none;stroke:var(--bp-line);stroke-width:1.4;stroke-linejoin:round}
.bp-svg .ic-f{fill:var(--bp-line)}.bp-svg .ic-s{stroke:var(--bp-fill)}
.bp-svg .bp-tk{fill:var(--bp-ink);font-size:12px}
.bp-svg .bp-ev,.bp-svg .bp-gt,.bp-svg .bp-nt{fill:var(--bp-ink);font-size:11.5px}
.bp-svg .bp-el{fill:var(--bp-ink);font-size:11.5px;paint-order:stroke;stroke:var(--bp-lane);stroke-width:4px;stroke-linejoin:round}
.bp-svg .bp-edge{fill:none;stroke:var(--bp-line);stroke-width:1.5}
.bp-svg .bp-edge.k-msg{stroke-dasharray:6 4}
.bp-svg .bp-edge.k-assoc{stroke-dasharray:2 3}
.bp-svg .bp-mfill{fill:var(--bp-line)}.bp-svg .bp-mopen{fill:var(--bp-fill);stroke:var(--bp-line);stroke-width:1.3}
.bp-svg .bp-hit{fill:transparent;stroke:none}
.bp-svg .bp-ehit{fill:none;stroke:transparent;stroke-width:14}
.bp-svg .bp-halo{fill:none;stroke:var(--bp-sel);stroke-width:2;stroke-dasharray:5 3}
.bp-svg .sel .bp-sh,.bp-svg .bp-e.sel .bp-edge{stroke:var(--bp-sel)}
.bp-svg .mk-bad .bp-sh,.bp-svg .bp-e.mk-bad .bp-edge{stroke:var(--bp-bad);stroke-width:3.4}
.bp-svg .mk-warn .bp-sh,.bp-svg .bp-e.mk-warn .bp-edge{stroke:var(--bp-warn);stroke-width:3.2}
.bp-svg .mk-ok .bp-sh{stroke:var(--bp-good);stroke-width:3}
.bp-svg .mk-hot .bp-sh{stroke:var(--bp-sel);stroke-width:3.4;fill:var(--bp-hot)}
.bp-svg .bp-tok{fill:var(--bp-tok);stroke:var(--bp-fill);stroke-width:1.5}
.bp-svg .bp-tokn{fill:var(--bp-fill);font-size:10px;font-weight:700}
.bp-svg .bp-pend{fill:var(--bp-lane);stroke:var(--bp-sel);stroke-width:1.6}`;
  const SA_VARS = 'svg.bp-svg{--bp-line:#1d2733;--bp-fill:#ffffff;--bp-lane:#ffffff;--bp-head:#eef1f4;--bp-ink:#111a24;--bp-sel:#2b4fa3;--bp-bad:#b0261c;--bp-warn:#a86300;--bp-good:#1b7648;--bp-hot:#e1e8f8;--bp-tok:#2b4fa3}';

  let SVGID = 0;
  /* Рисует схему. Параметры o: sel (выбранный элемент), marks ({id: 'bad'|'warn'|'ok'|'hot'}), tokens ({id потока: число}),
     pending (id потоков с ожидающим сообщением), standalone (для экспорта в файл), minW, minH, maxW (ограничить ширину). */
  let seqId = 0;
  function renderSvg(m, o) {
    o = o || {};
    fixBnd(m);
    const L = layout(m), I = idx(m), U = 'bp' + (++SVGID);
    const routes = {};
    m.edges.forEach(e => { routes[e.id] = route(m, L, I, e); });
    let maxX = 0, maxY = 0;
    m.nodes.forEach(n => { maxX = Math.max(maxX, n.x + halfW(n) + 40); maxY = Math.max(maxY, n.y + halfH(n) + 52); });
    Object.values(routes).forEach(r => r.forEach(p => { maxX = Math.max(maxX, p[0] + 30); maxY = Math.max(maxY, p[1] + 30); }));
    const W = Math.max(o.minW || 520, Math.ceil(maxX / 10) * 10), H = Math.max(o.minH || 160, Math.ceil(Math.max(maxY, L.bottom + 14) / 10) * 10);
    let s = '';
    /* пулы и дорожки */
    L.pools.forEach(p => {
      if (p.bb) {
        s += `<g class="bp-pool" data-pool="${p.id}"><rect x="0" y="${p.y}" width="${W}" height="${p.h}" class="bp-lane"/><rect x="0" y="${p.y}" width="${HEAD_W}" height="${p.h}" class="bp-head"/>${text(wrap(p.name, Math.max(6, Math.floor(p.h / 6.6)), 2), 0, 0, 'bp-pl', 14).replace('<text ', `<text transform="translate(${HEAD_W / 2},${p.y + p.h / 2}) rotate(-90)" `)}</g>`;
        return;
      }
      const named = p.lanes.length > 1 || (p.lanes[0] && p.lanes[0].name);
      s += `<g class="bp-pool" data-pool="${p.id}"><rect x="0" y="${p.y}" width="${W}" height="${p.h}" class="bp-lane"/><rect x="0" y="${p.y}" width="${HEAD_W}" height="${p.h}" class="bp-head"/>`;
      s += text(wrap(p.name, Math.max(6, Math.floor(p.h / 6.8)), 2), 0, 0, 'bp-pl', 14).replace('<text ', `<text transform="translate(${HEAD_W / 2},${p.y + p.h / 2}) rotate(-90)" `);
      p.lanes.forEach(l => {
        if (named) {
          s += `<g data-lane="${l.id}"><rect x="${HEAD_W}" y="${l.y}" width="${W - HEAD_W}" height="${l.h}" class="bp-lane"/><rect x="${HEAD_W}" y="${l.y}" width="${HEAD_W}" height="${l.h}" class="bp-head"/>`;
          s += text(wrap(l.name, Math.max(6, Math.floor(l.h / 6.6)), 2), 0, 0, 'bp-ll', 13).replace('<text ', `<text transform="translate(${HEAD_W * 1.5},${l.y + l.h / 2}) rotate(-90)" `) + '</g>';
        }
      });
      s += '</g>';
    });
    /* потоки */
    let eg = '';
    m.edges.forEach(e => {
      const pts = routes[e.id];
      if (!pts.length) return;
      const cls = ['bp-e'];
      if (o.sel === e.id) cls.push('sel');
      if (o.marks && o.marks[e.id]) cls.push('mk-' + o.marks[e.id]);
      const pl = pts.map(p => p.join(',')).join(' ');
      const marker = e.k === 'msg' ? ` marker-start="url(#${U}-oc)" marker-end="url(#${U}-oa)"` : e.k === 'assoc' ? '' : ` marker-end="url(#${U}-ar)"`;
      let extra = '';
      if (e.d && e.k === 'seq') {
        const [x, y] = pointAt(pts, 14), [x2, y2] = pointAt(pts, 20);
        const ang = Math.atan2(y2 - y, x2 - x) + Math.PI / 2;
        extra += `<path d="M${(x - Math.cos(ang) * 5).toFixed(1)},${(y - Math.sin(ang) * 5).toFixed(1)} L${(x + Math.cos(ang) * 5).toFixed(1)},${(y + Math.sin(ang) * 5).toFixed(1)}" class="bp-ln" transform="rotate(25 ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
      }
      let lab = '';
      if (e.l) {
        const lines = wrap(e.l, 16, 2), p0 = pts[0], p1 = pts[1] || pts[0];
        const horiz = Math.abs(p1[1] - p0[1]) < 1;
        const longEnough = polyLen(pts) > 40;
        let lx, ly, anchor = 'middle';
        if (horiz) { lx = p0[0] + Math.min(Math.abs(p1[0] - p0[0]) / 2, 44) * Math.sign(p1[0] - p0[0] || 1); ly = p0[1] - 8 - (lines.length - 1) * 6.5; }
        else { lx = p0[0] + 6; ly = p0[1] + (p1[1] > p0[1] ? 14 : -14); anchor = 'start'; }
        if (!longEnough) { const mid = pointAt(pts, polyLen(pts) / 2); lx = mid[0]; ly = mid[1] - 10; anchor = 'middle'; }
        lab = text(lines, lx.toFixed(1), ly.toFixed(1), 'bp-el', 13, anchor);
      }
      let tok = '';
      const nt = o.tokens && o.tokens[e.id];
      if (nt) {
        const [tx, ty] = pointAt(pts, Math.min(polyLen(pts) / 2, 30 + 0));
        tok = `<circle class="bp-tok" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="8"/>` + (nt > 1 ? `<text class="bp-tokn" text-anchor="middle" x="${tx.toFixed(1)}" y="${(ty + 3.4).toFixed(1)}">${nt}</text>` : '');
      }
      if (o.pending && o.pending[e.id]) {
        const [tx, ty] = pointAt(pts, polyLen(pts) / 2);
        tok += `<rect class="bp-pend" x="${(tx - 8).toFixed(1)}" y="${(ty - 6).toFixed(1)}" width="16" height="12" rx="1.5"/><path d="M${(tx - 8).toFixed(1)},${(ty - 6).toFixed(1)} L${tx.toFixed(1)},${(ty + 1).toFixed(1)} L${(tx + 8).toFixed(1)},${(ty - 6).toFixed(1)}" class="bp-ln"/>`;
      }
      eg += `<g class="${cls.join(' ')}" data-id="${e.id}"><polyline class="bp-ehit" points="${pl}"/><polyline class="bp-edge k-${e.k}" points="${pl}"${marker}/>${extra}${lab}${tok}</g>`;
    });
    /* порядок: сначала потоки (под фигурами), затем фигуры */
    let ng = '';
    m.nodes.forEach(n => { if (n.t !== 'bnd') ng += nodeSvg(n, o); });
    m.nodes.forEach(n => { if (n.t === 'bnd') ng += nodeSvg(n, o); });
    const defs = `<defs><marker id="${U}-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="bp-mfill"/></marker><marker id="${U}-oa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9 z" class="bp-mopen"/></marker><marker id="${U}-oc" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8"><circle cx="5" cy="5" r="3.4" class="bp-mopen"/></marker></defs>`;
    const style = o.standalone ? `<style>${SA_VARS}${CSS}</style>` : '';
    const size = o.maxW ? `style="max-width:min(100%,${W}px);height:auto"` : '';
    return `<svg class="bp-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${size} role="img"${o.title ? ` aria-label="${X(o.title)}"` : ''}>${style}${defs}${s}${eg}${ng}</svg>`;
  }
  /* Рисунок для текста модуля: схема по краткой записи и подпись. */
  function fig(dsl, caption, opts) {
    const m = typeof dsl === 'string' ? parseDsl(dsl) : dsl;
    return `<figure class="bp-fig"><div class="bp-scroll">${renderSvg(m, Object.assign({ maxW: true, title: caption || 'Схема BPMN' }, opts || {}))}</div>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  }
  /* Отдельный элемент для вопросов «узнай символ». */
  function symbol(t, k, label) {
    const m = empty();
    m.nodes.push({ id: 'z1', t, k, l: label || '', x: 80, y: 52 });
    return renderSvg(m, { minW: 160, minH: 110, maxW: true, title: 'Символ BPMN' });
  }

  /* Маленькая иконка элемента для палитры. */
  function iconSvg(t, k) {
    const [w, h] = SZ[t];
    const n = { id: 'ic', t, k: k || undefined, l: '', x: 0, y: 0, host: '' };
    if (t === 'bnd') n.host = '';
    const vb = `${-w / 2 - 4} ${-h / 2 - 4} ${w + 8} ${h + 8}`;
    const hgt = t === 'task' || t === 'sub' || t === 'call' ? 22 : t === 'note' ? 20 : 26;
    return `<svg class="bp-svg bp-icon" viewBox="${vb}" height="${hgt}" width="${Math.round(hgt * (w + 8) / (h + 8))}" aria-hidden="true">${nodeSvg(n, {})}</svg>`;
  }

  /* ===== операции редактора ===== */
  function nodeAt(m, id) { return m.nodes.find(n => n.id === id); }
  function addNode(m, t, k, x, y, label) {
    if (!SZ[t] || m.nodes.length >= LIM.nodes) return null;
    const n = { id: uid(m, 'n'), t, l: label || '', x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
    if (k && KINDS[t] && KINDS[t].includes(k)) n.k = k;
    m.nodes.push(n);
    return n;
  }
  function addBoundary(m, hostId, k) {
    const h = nodeAt(m, hostId);
    if (!h || !['task', 'sub', 'call'].includes(h.t) || m.nodes.length >= LIM.nodes) return null;
    const n = { id: uid(m, 'n'), t: 'bnd', host: hostId, k: KINDS.bnd.includes(k) ? k : 'timer', l: '', x: h.x, y: h.y };
    m.nodes.push(n);
    fixBnd(m);
    return n;
  }
  function removeEdge(m, id) { m.edges = m.edges.filter(e => e.id !== id); }
  function removeNode(m, id) {
    const kill = new Set([id]);
    m.nodes.forEach(n => { if (n.t === 'bnd' && n.host === id) kill.add(n.id); });
    m.nodes = m.nodes.filter(n => !kill.has(n.id));
    m.edges = m.edges.filter(e => !kill.has(e.f) && !kill.has(e.to));
  }
  /* Возвращает текст ошибки, если соединять нельзя, иначе пустую строку. */
  function canConnect(m, a, b, kind) {
    const I = idx(m), L = layout(m);
    const A = I.by[a], B = I.by[b], PA = I.pools[a], PB = I.pools[b];
    if (a === b) return 'Нельзя соединить элемент с самим собой.';
    if (!A && !PA) return 'Не найден начальный элемент.';
    if (!B && !PB) return 'Не найден конечный элемент.';
    if (m.edges.some(e => e.f === a && e.to === b && e.k === kind)) return 'Такой поток уже есть.';
    const dataLike = t => ['data', 'store', 'note'].includes(t);
    if (kind === 'assoc') return (A && dataLike(A.t)) || (B && dataLike(B.t)) ? '' : 'Ассоциация связывает данные или комментарий с другим элементом.';
    if ((A && dataLike(A.t)) || (B && dataLike(B.t))) return 'Данные и комментарии соединяют ассоциацией (пунктир), а не потоком.';
    if (kind === 'msg') {
      const pa = A ? poolOf(L, A) : a, pb = B ? poolOf(L, B) : b;
      if (!pa || !pb) return 'Потоки сообщений проводят между пулами. Сначала добавьте пулы.';
      if (pa === pb) return 'Поток сообщений соединяет разные пулы. Внутри одного пула используйте поток последовательности.';
      if (A && isGate(A.t)) return 'Шлюз не может отправлять сообщения.';
      if (B && isGate(B.t)) return 'Шлюз не может получать сообщения.';
      if (A && ['start', 'bnd'].includes(A.t)) return 'Начальное или граничное событие не отправляет сообщение.';
      if (B && ['end'].includes(B.t)) return 'Конечное событие не принимает сообщение.';
      return '';
    }
    if (PA || PB) return 'К границе пула подключаются только потоки сообщений.';
    if (A.t === 'end') return 'У конечного события не бывает исходящих потоков.';
    if (B.t === 'start') return 'У начального события не бывает входящих потоков.';
    if (B.t === 'bnd') return 'Граничное событие прикрепляется к задаче, входящих потоков у него нет.';
    if (poolOf(L, A) !== poolOf(L, B)) return 'Поток последовательности не пересекает границу пула. Между пулами используйте поток сообщений.';
    return '';
  }
  function addEdge(m, a, b, kind) {
    const err = canConnect(m, a, b, kind);
    if (err) return { err };
    if (m.edges.length >= LIM.edges) return { err: 'Слишком много потоков.' };
    const e = { id: uid(m, 'e'), f: a, to: b, l: '', k: kind };
    m.edges.push(e);
    return { edge: e };
  }
  /* Изменение раскладки пулов с сохранением положения фигур внутри своих дорожек. */
  function relayout(m, fn) {
    const L0 = layout(m);
    const keep = m.nodes.filter(n => n.t !== 'bnd').map(n => {
      const l = laneOf(L0, n), p = l ? null : L0.pools.find(pp => n.y >= pp.y && n.y < pp.y + pp.h);
      return { n, lane: l ? l.id : null, dy: l ? n.y - l.y : (p ? n.y - p.y : 0), pool: p ? p.id : null };
    });
    fn();
    const L1 = layout(m);
    keep.forEach(k => {
      if (k.lane) { const l = L1.lanes.find(x => x.id === k.lane); if (l) k.n.y = l.y + Math.min(k.dy, l.h - 20); }
      else if (k.pool) { const p = L1.pools.find(x => x.id === k.pool); if (p) k.n.y = p.y + k.dy; }
    });
    fixBnd(m);
  }
  function addPool(m, name, bb) {
    if (m.pools.length >= LIM.pools) return null;
    const p = { id: uid(m, 'p'), name: name || (bb ? 'Участник' : 'Процесс'), lanes: [], bb: !!bb };
    if (!bb) p.lanes.push({ id: uid(m, 'l'), name: '', h: LANE_H });
    relayout(m, () => { m.pools.push(p); });
    return p;
  }
  function addLane(m, poolId, name) {
    const p = m.pools.find(x => x.id === poolId);
    if (!p || p.bb || p.lanes.length >= LIM.lanes) return null;
    let l;
    relayout(m, () => {
      if (p.lanes.length === 1 && !p.lanes[0].name) p.lanes[0].name = 'Дорожка 1';
      l = { id: uid(m, 'l'), name: name || 'Дорожка ' + (p.lanes.length + 1), h: LANE_H };
      p.lanes.push(l);
    });
    return l;
  }
  function removeLane(m, laneId) {
    const L = layout(m);
    const lane = L.lanes.find(l => l.id === laneId);
    if (!lane) return false;
    const p = m.pools.find(x => x.id === lane.pool);
    if (p.lanes.length <= 1) {
      /* последняя дорожка: удаляется весь пул вместе с фигурами */
      const doomed = m.nodes.filter(n => n.t !== 'bnd' && poolOf(L, n) === p.id).map(n => n.id);
      doomed.forEach(id => removeNode(m, id));
      relayout(m, () => { m.pools = m.pools.filter(x => x.id !== p.id); });
      return true;
    }
    const doomed = m.nodes.filter(n => n.t !== 'bnd' && laneOf(L, n) && laneOf(L, n).id === laneId).map(n => n.id);
    doomed.forEach(id => removeNode(m, id));
    relayout(m, () => { p.lanes = p.lanes.filter(l => l.id !== laneId); });
    return true;
  }
  function removePool(m, poolId) {
    const L = layout(m);
    const doomed = m.nodes.filter(n => n.t !== 'bnd' && poolOf(L, n) === poolId).map(n => n.id);
    doomed.forEach(id => removeNode(m, id));
    m.edges = m.edges.filter(e => e.f !== poolId && e.to !== poolId);
    relayout(m, () => { m.pools = m.pools.filter(x => x.id !== poolId); });
  }
  function setLaneHeight(m, laneId, h) {
    const p = m.pools.find(pp => pp.lanes.some(l => l.id === laneId));
    if (!p) return;
    const l = p.lanes.find(x => x.id === laneId);
    relayout(m, () => { l.h = num(h, 80, 400, LANE_H); });
  }

  return {
    SZ, KINDS, KIND_RU, TYPE_RU, FLOW_TYPES, GATES, LANE_H, COLW, ROWH, CSS, SA_VARS, LIM,
    isFlow, isGate, halfW, halfH,
    empty, copy, uid, idx, layout, laneOf, poolOf, fixBnd, parseDsl, toJson, fromJson,
    route, polyLen, pointAt, wrap, renderSvg, fig, symbol, iconSvg,
    nodeAt, addNode, addBoundary, removeEdge, removeNode, canConnect, addEdge, relayout, addPool, addLane, removeLane, removePool, setLaneHeight
  };
})();
