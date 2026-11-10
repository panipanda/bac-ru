'use strict';
/* Иллюстрации для модулей про UML и данные: диаграмма последовательности, состояний, вариантов использования, ER.
   Все рисуются в SVG из краткого описания и используют те же цвета, что и схемы BPMN. Файл не обращается к DOM. */

const UML = (function () {
  const X = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let uid = 0;
  const wrap = BPMN.wrap;
  const text = (lines, x, y, cls, lh, anchor) => {
    const y0 = y - (lines.length - 1) * lh / 2;
    return `<text class="${cls}" text-anchor="${anchor || 'middle'}" x="${x}">` + lines.map((s, i) => `<tspan x="${x}" y="${(y0 + i * lh).toFixed(1)}" dy=".34em">${X(s)}</tspan>`).join('') + '</text>';
  };
  const svg = (w, h, inner, title, defs) => `<svg class="bp-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:min(100%,${w}px);height:auto" role="img" aria-label="${X(title || 'Диаграмма')}">${defs || ''}${inner}</svg>`;
  const fig = (s, caption) => `<figure class="bp-fig"><div class="bp-scroll">${s}</div>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  const arrowDefs = id => `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="bp-mfill"/></marker><marker id="${id}o" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9" class="bp-ln" /></marker></defs>`;

  /* Диаграмма последовательности. parts: ['Клиент', 'Сайт'], msgs: [[от, к, 'подпись', 'ret'|'async']] (номера участников с нуля) */
  function seq(parts, msgs, caption) {
    const id = 'sq' + (++uid), gap = 190, left = 30, top = 20, bw = 140, rowH = 44;
    const W = left * 2 + gap * (parts.length - 1) + bw, H = top + 46 + msgs.length * rowH + 40;
    const cx = i => left + bw / 2 + i * gap;
    let s = '';
    parts.forEach((p, i) => {
      s += `<line x1="${cx(i)}" y1="${top + 36}" x2="${cx(i)}" y2="${H - 14}" class="bp-ln bp-dash"/>`;
      s += `<rect x="${cx(i) - bw / 2}" y="${top}" width="${bw}" height="36" rx="4" class="bp-sh"/>` + text(wrap(p, 20, 2), cx(i), top + 18, 'bp-tk', 13);
    });
    msgs.forEach((m, k) => {
      const y = top + 46 + 28 + k * rowH, a = cx(m[0]), b = cx(m[1]);
      const ret = m[3] === 'ret';
      if (m[0] === m[1]) { s += `<path d="M${a},${y - 12} h34 v22 h-34" class="bp-ln" marker-end="url(#${id})"/>` + text(wrap(m[2], 22, 2), a + 40, y - 1, 'bp-ev', 13, 'start'); return; }
      const dir = Math.sign(b - a);
      s += `<line x1="${a}" y1="${y}" x2="${b - dir * 1}" y2="${y}" class="bp-ln${ret ? ' bp-dash' : ''}" marker-end="url(#${id}${ret || m[3] === 'async' ? 'o' : ''})"/>`;
      s += text([m[2]], (a + b) / 2, y - 10, 'bp-el', 13);
    });
    return fig(svg(W, H, s, caption, arrowDefs(id)), caption);
  }

  /* Диаграмма состояний.
     S id col,row "Название" | I id col,row | F id col,row | T от к "событие [условие] / действие" */
  function state(src, caption) {
    const m = BPMN.empty(), nodes = {}, trs = [];
    const id = 'st' + (++uid);
    src.split('\n').forEach(raw => {
      const l = raw.trim(); if (!l) return;
      const q = (l.match(/"([^"]*)"/) || [])[1] || '';
      const w = l.replace(/"[^"]*"/, '').trim().split(/\s+/);
      if (w[0] === 'S' || w[0] === 'I' || w[0] === 'F') {
        const [c, r] = w[2].split(',').map(Number);
        const n = { id: w[1], t: w[0] === 'S' ? 'task' : w[0] === 'I' ? 'start' : 'end', l: q, x: 80 + c * 190, y: 56 + r * 100 };
        m.nodes.push(n); nodes[n.id] = { n, kind: w[0] };
      } else if (w[0] === 'T') { m.edges.push({ id: 'f' + (m.edges.length + 1), f: w[1], to: w[2], l: q, k: 'seq' }); }
    });
    const L = BPMN.layout(m), I = BPMN.idx(m);
    let W = 300, H = 140, s = '';
    m.nodes.forEach(n => { W = Math.max(W, n.x + 110); H = Math.max(H, n.y + 60); });
    m.edges.forEach(e => {
      const pts = BPMN.route(m, L, I, e);
      if (!pts.length) return;
      s += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" class="bp-edge" marker-end="url(#${id})"/>`;
      if (e.l) {
        const p0 = pts[0], p1 = pts[1] || p0, horiz = Math.abs(p1[1] - p0[1]) < 1;
        const ln = wrap(e.l, 24, 3);
        const mid = BPMN.pointAt(pts, BPMN.polyLen(pts) / 2);
        s += text(ln, mid[0].toFixed(1), (mid[1] - (horiz ? 14 : 0)).toFixed(1), 'bp-el', 13, horiz ? 'middle' : 'start').replace('x="' + mid[0].toFixed(1) + '"', 'x="' + (mid[0] + (horiz ? 0 : 8)).toFixed(1) + '"');
      }
    });
    m.nodes.forEach(n => {
      const k = nodes[n.id].kind;
      if (k === 'S') s += `<rect x="${n.x - 60}" y="${n.y - 32}" width="120" height="64" rx="14" class="bp-sh"/>` + text(wrap(n.l, 15, 3), n.x, n.y, 'bp-tk', 14);
      else if (k === 'I') s += `<circle cx="${n.x}" cy="${n.y}" r="12" class="bp-ln ic-f" style="fill:var(--bp-line)"/>`;
      else s += `<circle cx="${n.x}" cy="${n.y}" r="14" class="bp-ln"/><circle cx="${n.x}" cy="${n.y}" r="8" style="fill:var(--bp-line)"/>`;
    });
    return fig(svg(W + 20, H + 10, s, caption, arrowDefs(id)), caption);
  }

  /* Диаграмма вариантов использования. actors: [['Клиент','l'], ['Оператор','r']], cases: ['Оформить заказ', ...],
     links: [[актор, вариант]], rel: [[вариант, вариант, 'include'|'extend']] (номера с нуля) */
  function usecase(system, actors, cases, links, rel, caption) {
    const id = 'uc' + (++uid);
    const rowH = 66, top = 54, H = top + cases.length * rowH + 20, W = 640;
    const sx = 170, sw = W - 2 * sx;
    let s = `<rect x="${sx}" y="10" width="${sw}" height="${H - 20}" rx="8" class="bp-lane"/>` + text([system], sx + sw / 2, 28, 'bp-pl', 14);
    const cy = i => top + 16 + i * rowH + 18;
    cases.forEach((c, i) => { s += `<ellipse cx="${sx + sw / 2}" cy="${cy(i)}" rx="108" ry="25" class="bp-sh"/>` + text(wrap(c, 24, 2), sx + sw / 2, cy(i), 'bp-tk', 13); });
    const pos = {};
    ['l', 'r'].forEach(side => {
      const as = actors.filter(a => a[1] === side);
      as.forEach((a, k) => {
        const ys = links.filter(l => l[0] === a[0]).map(l => cy(l[1]));
        const y = ys.length ? ys.reduce((x, z) => x + z, 0) / ys.length : H / 2;
        const x = side === 'l' ? 70 : W - 70;
        const yy = as.length > 1 ? Math.max(70, Math.min(H - 60, y + (k - (as.length - 1) / 2) * 60)) : y;
        pos[a[0]] = [x, yy];
        s += `<circle cx="${x}" cy="${yy - 26}" r="9" class="bp-sh"/><path d="M${x},${yy - 17} v24 M${x - 16},${yy - 8} h32 M${x},${yy + 7} l-13,20 M${x},${yy + 7} l13,20" class="bp-ln"/>` + text(wrap(a[0], 14, 2), x, yy + 44, 'bp-ev', 13);
      });
    });
    links.forEach(l => { const p = pos[l[0]]; if (!p) return; const left = p[0] < W / 2; s += `<line x1="${p[0] + (left ? 18 : -18)}" y1="${p[1] - 2}" x2="${sx + sw / 2 + (left ? -108 : 108) * 0.92}" y2="${cy(l[1])}" class="bp-ln"/>`; });
    (rel || []).forEach(r => {
      const x = sx + sw / 2 + 80;
      s += `<path d="M${x},${cy(r[0]) + 24} V${cy(r[1]) - 24}" class="bp-ln bp-dash" marker-end="url(#${id}o)"/>` + text(['«' + r[2] + '»'], x + 6, (cy(r[0]) + cy(r[1])) / 2, 'bp-ev', 12, 'start');
    });
    return fig(svg(W, H, s, caption, arrowDefs(id)), caption);
  }

  /* ER-диаграмма. tables: [['customers', ['id PK', 'name', 'city'], col, row]], rels: [[от, к, '1', 'N', 'подпись']] */
  function er(tables, rels, caption) {
    const bw = 190, colW = 270, rowH = 190, by = {};
    let W = 0, H = 0, s = '';
    tables.forEach(t => {
      const h = 28 + t[1].length * 21 + 8, x = 20 + t[2] * colW, y = 16 + t[3] * rowH;
      by[t[0]] = { x, y, h }; W = Math.max(W, x + bw + 20); H = Math.max(H, y + h + 16);
    });
    rels.forEach(r => {
      const a = by[r[0]], b = by[r[1]];
      let x1, y1, x2, y2;
      if (a.x === b.x) { const down = b.y > a.y; x1 = a.x + bw / 2; y1 = a.y + (down ? a.h : 0); x2 = b.x + bw / 2; y2 = b.y + (down ? 0 : b.h); }
      else { const right = b.x > a.x; x1 = a.x + (right ? bw : 0); y1 = a.y + 36; x2 = b.x + (right ? 0 : bw); y2 = b.y + 36; }
      const pts = a.x === b.x ? [[x1, y1], [x2, y2]] : [[x1, y1], [(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2], [x2, y2]];
      s += `<polyline class="bp-edge" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
      const side = (p, q, mark) => text([mark], p[0] + Math.sign(q[0] - p[0]) * 12 + 0, p[1] - 9, 'bp-el', 13);
      s += side([x1, y1], [x2, y2], r[2]) + side([x2, y2], [x1, y1], r[3]);
      if (r[4]) s += text([r[4]], (x1 + x2) / 2, Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 8, 'bp-ev', 12);
    });
    tables.forEach(t => {
      const b = by[t[0]];
      s += `<rect x="${b.x}" y="${b.y}" width="${bw}" height="${b.h}" rx="4" class="bp-sh"/><rect x="${b.x}" y="${b.y}" width="${bw}" height="28" rx="4" class="bp-head"/>` + text([t[0]], b.x + bw / 2, b.y + 14, 'bp-pl', 13);
      t[1].forEach((c, i) => { s += text([c], b.x + 10, b.y + 28 + 16 + i * 21, /PK|FK/.test(c) ? 'bp-tk bp-key' : 'bp-tk', 13, 'start'); });
    });
    return fig(svg(W, H, s, caption), caption);
  }

  return { seq, state, usecase, er };
})();
