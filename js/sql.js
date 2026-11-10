'use strict';
/* Мини-SQL для учебного практикума: SELECT с WHERE, JOIN (INNER и LEFT), GROUP BY, HAVING, ORDER BY, LIMIT,
   агрегатами и несколькими функциями. Работает на небольших таблицах в памяти, без обращения к DOM. */

const SQL = (function () {
  const RESERVED = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'LIMIT', 'JOIN', 'INNER', 'LEFT', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'IS', 'NULL', 'BETWEEN', 'AS', 'ASC', 'DESC', 'DISTINCT']);
  const AGG = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
  const err = m => { const e = new Error(m); e.sql = true; return e; };

  function tokenize(src) {
    const re = /\s+|--[^\n]*|('(?:[^']|'')*')|(\d+(?:\.\d+)?)|([\p{L}_][\p{L}\p{N}_]*)|(<=|>=|<>|!=|[=<>+\-*\/(),.;])/uy;
    const out = [];
    let pos = 0;
    while (pos < src.length) {
      re.lastIndex = pos;
      const m = re.exec(src);
      if (!m) throw err('Не удалось разобрать запрос около «' + src.slice(pos, pos + 12).trim() + '».');
      const start = pos;
      pos = re.lastIndex;
      if (m[1]) out.push({ t: 'str', v: m[1].slice(1, -1).replace(/''/g, "'"), s: start, e: pos });
      else if (m[2]) out.push({ t: 'num', v: parseFloat(m[2]), s: start, e: pos });
      else if (m[3]) out.push({ t: 'id', v: m[3], u: m[3].toUpperCase(), s: start, e: pos });
      else if (m[4]) out.push({ t: 'op', v: m[4], s: start, e: pos });
    }
    out.push({ t: 'eof', s: src.length, e: src.length });
    return out;
  }

  function parse(src) {
    const tk = tokenize(src);
    let i = 0;
    const isKw = (...w) => tk[i].t === 'id' && w.includes(tk[i].u);
    const isOp = (...o) => tk[i].t === 'op' && o.includes(tk[i].v);
    const near = () => tk[i].t === 'eof' ? 'конец запроса' : '«' + src.slice(tk[i].s, tk[i].e) + '»';
    const need = m => { throw err('Синтаксическая ошибка: ожидалось ' + m + ', найдено ' + near() + '.'); };
    const eatKw = w => { if (isKw(w)) { i++; return true; } return false; };
    const wantKw = w => { if (!eatKw(w)) need(w); };
    const eatOp = o => { if (isOp(o)) { i++; return true; } return false; };
    const wantOp = o => { if (!eatOp(o)) need('«' + o + '»'); };
    const ident = () => { const t = tk[i]; if (t.t !== 'id' || RESERVED.has(t.u)) need('имя'); i++; return t.v; };

    function primary() {
      const t = tk[i];
      if (t.t === 'num') { i++; return { t: 'num', v: t.v }; }
      if (t.t === 'str') { i++; return { t: 'str', v: t.v }; }
      if (isOp('(')) { i++; const e = orExpr(); wantOp(')'); return e; }
      if (isOp('-')) { i++; return { t: 'un', op: '-', e: primary() }; }
      if (isKw('NULL')) { i++; return { t: 'null' }; }
      if (t.t === 'id' && !RESERVED.has(t.u)) {
        i++;
        if (isOp('(')) {
          i++;
          const up = t.u;
          if (AGG.has(up)) {
            if (isOp('*')) { i++; wantOp(')'); if (up !== 'COUNT') throw err('Звёздочка допустима только в COUNT(*).'); return { t: 'agg', name: up, star: true }; }
            const d = eatKw('DISTINCT');
            const a = orExpr(); wantOp(')');
            return { t: 'agg', name: up, arg: a, distinct: d };
          }
          const args = [];
          if (!isOp(')')) { do { args.push(orExpr()); } while (eatOp(',')); }
          wantOp(')');
          if (!['UPPER', 'LOWER', 'ROUND', 'COALESCE', 'LENGTH', 'ABS'].includes(up)) throw err('Неизвестная функция ' + t.v + '. Доступны: COUNT, SUM, AVG, MIN, MAX, ROUND, UPPER, LOWER, COALESCE, LENGTH, ABS.');
          return { t: 'fn', name: up, args };
        }
        if (isOp('.')) { i++; const n = ident(); return { t: 'col', q: t.v, n }; }
        return { t: 'col', q: null, n: t.v };
      }
      return need('выражение');
    }
    function mul() { let l = primary(); while (isOp('*', '/')) { const op = tk[i++].v; l = { t: 'bin', op, l, r: primary() }; } return l; }
    function add() { let l = mul(); while (isOp('+', '-')) { const op = tk[i++].v; l = { t: 'bin', op, l, r: mul() }; } return l; }
    function cmp() {
      const l = add();
      if (isOp('=', '<>', '!=', '<', '<=', '>', '>=')) { const op = tk[i++].v; return { t: 'bin', op: op === '!=' ? '<>' : op, l, r: add() }; }
      if (isKw('IS')) { i++; const not = eatKw('NOT'); wantKw('NULL'); return { t: 'isnull', e: l, not }; }
      let not = false;
      if (isKw('NOT') && tk[i + 1].t === 'id' && ['IN', 'LIKE', 'BETWEEN'].includes(tk[i + 1].u)) { i++; not = true; }
      if (eatKw('IN')) { wantOp('('); const list = []; do { list.push(orExpr()); } while (eatOp(',')); wantOp(')'); return { t: 'in', e: l, list, not }; }
      if (eatKw('LIKE')) return { t: 'like', e: l, p: add(), not };
      if (eatKw('BETWEEN')) { const lo = add(); wantKw('AND'); const hi = add(); return { t: 'between', e: l, lo, hi, not }; }
      return l;
    }
    function notE() { if (eatKw('NOT')) return { t: 'un', op: 'NOT', e: notE() }; return cmp(); }
    function andE() { let l = notE(); while (eatKw('AND')) l = { t: 'bin', op: 'AND', l, r: notE() }; return l; }
    function orExpr() { let l = andE(); while (eatKw('OR')) l = { t: 'bin', op: 'OR', l, r: andE() }; return l; }

    wantKw('SELECT');
    const q = { distinct: eatKw('DISTINCT'), cols: [], joins: [], group: [], order: [], limit: null, where: null, having: null };
    if (isOp('*')) { i++; q.cols.push({ star: true }); } else {
      do {
        const s0 = tk[i].s;
        const e = orExpr();
        const raw = src.slice(s0, tk[i - 1].e);
        let alias = null;
        if (eatKw('AS')) alias = ident();
        else if (tk[i].t === 'id' && !RESERVED.has(tk[i].u)) alias = ident();
        q.cols.push({ e, alias, raw });
      } while (eatOp(','));
    }
    wantKw('FROM');
    const tbl = () => { const name = ident(); let alias = name; if (eatKw('AS')) alias = ident(); else if (tk[i].t === 'id' && !RESERVED.has(tk[i].u)) alias = ident(); return { name, alias }; };
    q.from = tbl();
    for (;;) {
      let left = false;
      if (isKw('LEFT')) { i++; eatKw('OUTER'); left = true; wantKw('JOIN'); } else if (isKw('INNER')) { i++; wantKw('JOIN'); } else if (!eatKw('JOIN')) break;
      const t = tbl(); wantKw('ON');
      q.joins.push({ t, left, on: orExpr() });
    }
    if (eatKw('WHERE')) q.where = orExpr();
    if (eatKw('GROUP')) { wantKw('BY'); do { q.group.push(orExpr()); } while (eatOp(',')); }
    if (eatKw('HAVING')) q.having = orExpr();
    if (eatKw('ORDER')) { wantKw('BY'); do { const e = orExpr(); let desc = false; if (eatKw('DESC')) desc = true; else eatKw('ASC'); q.order.push({ e, desc }); } while (eatOp(',')); }
    if (eatKw('LIMIT')) { const t = tk[i]; if (t.t !== 'num') need('число'); i++; q.limit = t.v; }
    eatOp(';');
    if (tk[i].t !== 'eof') throw err('Синтаксическая ошибка около ' + near() + '. Возможно, пропущена запятая или ключевое слово.');
    return q;
  }

  const hasAgg = e => !!e && (e.t === 'agg' || (e.t === 'bin' && (hasAgg(e.l) || hasAgg(e.r))) || (e.t === 'un' && hasAgg(e.e)) || (e.t === 'fn' && e.args.some(hasAgg)) || (e.t === 'isnull' && hasAgg(e.e)) || (e.t === 'in' && (hasAgg(e.e) || e.list.some(hasAgg))) || (e.t === 'between' && (hasAgg(e.e) || hasAgg(e.lo) || hasAgg(e.hi))) || (e.t === 'like' && hasAgg(e.e)));
  const isNull = v => v === null || v === undefined;
  const tri = v => isNull(v) ? null : !!v;

  function ev(e, c) {
    switch (e.t) {
      case 'num': case 'str': return e.v;
      case 'null': return null;
      case 'col': return c.col(e.q, e.n);
      case 'un': { const v = ev(e.e, c); return e.op === '-' ? (isNull(v) ? null : -v) : (isNull(v) ? null : !v); }
      case 'bin': {
        if (e.op === 'AND') { const a = tri(ev(e.l, c)); if (a === false) return false; const b = tri(ev(e.r, c)); if (b === false) return false; return (a === null || b === null) ? null : true; }
        if (e.op === 'OR') { const a = tri(ev(e.l, c)); if (a === true) return true; const b = tri(ev(e.r, c)); if (b === true) return true; return (a === null || b === null) ? null : false; }
        const a = ev(e.l, c), b = ev(e.r, c);
        if (isNull(a) || isNull(b)) return null;
        switch (e.op) {
          case '=': return a === b; case '<>': return a !== b; case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
          case '+': return a + b; case '-': return a - b; case '*': return a * b;
          case '/': if (b === 0) throw err('Деление на ноль.'); return a / b;
        }
        return null;
      }
      case 'isnull': { const v = ev(e.e, c); return e.not ? !isNull(v) : isNull(v); }
      case 'in': { const v = ev(e.e, c); if (isNull(v)) return null; const hit = e.list.some(x => ev(x, c) === v); return e.not ? !hit : hit; }
      case 'between': { const v = ev(e.e, c), lo = ev(e.lo, c), hi = ev(e.hi, c); if ([v, lo, hi].some(isNull)) return null; const r = v >= lo && v <= hi; return e.not ? !r : r; }
      case 'like': {
        const v = ev(e.e, c), p = ev(e.p, c); if (isNull(v) || isNull(p)) return null;
        const re = new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'is');
        const r = re.test(String(v)); return e.not ? !r : r;
      }
      case 'fn': {
        const a = e.args.map(x => ev(x, c));
        switch (e.name) {
          case 'UPPER': return isNull(a[0]) ? null : String(a[0]).toUpperCase();
          case 'LOWER': return isNull(a[0]) ? null : String(a[0]).toLowerCase();
          case 'LENGTH': return isNull(a[0]) ? null : String(a[0]).length;
          case 'ABS': return isNull(a[0]) ? null : Math.abs(a[0]);
          case 'ROUND': { if (isNull(a[0])) return null; const k = Math.pow(10, a[1] || 0); return Math.round(a[0] * k + 1e-9) / k; }
          case 'COALESCE': { const f = a.find(x => !isNull(x)); return f === undefined ? null : f; }
        }
        return null;
      }
      case 'agg': {
        if (!c.group) throw err('Агрегатная функция ' + e.name + ' допустима в SELECT, HAVING и ORDER BY, но не в WHERE.');
        if (e.star) return c.group.length;
        let vals = c.group.map(r => ev(e.arg, c.sub(r))).filter(v => !isNull(v));
        if (e.distinct) vals = [...new Set(vals)];
        if (e.name === 'COUNT') return vals.length;
        if (!vals.length) return null;
        if (e.name === 'SUM') return vals.reduce((a, b) => a + b, 0);
        if (e.name === 'AVG') return vals.reduce((a, b) => a + b, 0) / vals.length;
        if (e.name === 'MIN') return vals.reduce((a, b) => (b < a ? b : a));
        return vals.reduce((a, b) => (b > a ? b : a));
      }
    }
    throw err('Неподдерживаемое выражение.');
  }

  function makeCtx(aliasCols, row, group) {
    return {
      group,
      col(q, n) {
        const ln = n.toLowerCase();
        if (q) {
          const a = Object.keys(aliasCols).find(k => k.toLowerCase() === q.toLowerCase());
          if (!a) throw err('Неизвестная таблица или псевдоним «' + q + '».');
          if (!aliasCols[a].includes(ln)) throw err('В таблице «' + q + '» нет столбца «' + n + '».');
          const r = row[a]; return r ? r[ln] : null;
        }
        const hits = Object.keys(aliasCols).filter(k => aliasCols[k].includes(ln));
        if (!hits.length) throw err('Неизвестный столбец «' + n + '».');
        if (hits.length > 1) throw err('Столбец «' + n + '» есть в нескольких таблицах. Уточните: таблица.' + n + '.');
        const r = row[hits[0]]; return r ? r[ln] : null;
      },
      sub: r => makeCtx(aliasCols, r, null)
    };
  }

  /* Выполняет запрос. db: { таблица: { cols: [имена], rows: [[значения]] } }. Возвращает { cols, rows }. */
  function run(db, src) {
    const q = parse(src);
    const lower = {};
    Object.keys(db).forEach(k => { lower[k.toLowerCase()] = k; });
    const getT = t => { const k = lower[t.name.toLowerCase()]; if (!k) throw err('Неизвестная таблица «' + t.name + '». Доступны: ' + Object.keys(db).join(', ') + '.'); return db[k]; };
    const aliasCols = {};
    const toObj = (t, r) => { const o = {}; t.cols.forEach((c, i) => { o[c.toLowerCase()] = r[i]; }); return o; };
    const base = getT(q.from);
    aliasCols[q.from.alias] = base.cols.map(c => c.toLowerCase());
    let rows = base.rows.map(r => ({ [q.from.alias]: toObj(base, r) }));
    q.joins.forEach(j => {
      const t = getT(j.t);
      if (aliasCols[j.t.alias]) throw err('Псевдоним «' + j.t.alias + '» используется дважды.');
      aliasCols[j.t.alias] = t.cols.map(c => c.toLowerCase());
      const right = t.rows.map(r => toObj(t, r));
      const out = [];
      rows.forEach(l => {
        let hit = false;
        right.forEach(r => {
          const row = Object.assign({}, l, { [j.t.alias]: r });
          if (ev(j.on, makeCtx(aliasCols, row, null)) === true) { out.push(row); hit = true; }
        });
        if (!hit && j.left) { const nulls = {}; t.cols.forEach(c => { nulls[c.toLowerCase()] = null; }); out.push(Object.assign({}, l, { [j.t.alias]: nulls })); }
      });
      rows = out;
    });
    if (q.where) {
      if (hasAgg(q.where)) throw err('Агрегатные функции нельзя использовать в WHERE. Для условий по группам есть HAVING.');
      rows = rows.filter(r => ev(q.where, makeCtx(aliasCols, r, null)) === true);
    }
    const sel = [];
    q.cols.forEach(c => {
      if (c.star) Object.keys(aliasCols).forEach(a => aliasCols[a].forEach(n => sel.push({ e: { t: 'col', q: a, n }, name: n })));
      else sel.push({ e: c.e, name: c.alias || (c.e.t === 'col' ? c.e.n : c.raw) });
    });
    const aggregated = q.group.length > 0 || sel.some(s => hasAgg(s.e)) || (q.having && hasAgg(q.having));
    let out;
    if (aggregated) {
      const groups = new Map();
      rows.forEach(r => {
        const key = JSON.stringify(q.group.map(g => ev(g, makeCtx(aliasCols, r, null))));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      });
      if (!q.group.length && !groups.size) groups.set('[]', []);
      let gl = [...groups.values()];
      const gctx = g => makeCtx(aliasCols, g[0] || {}, g);
      if (q.having) gl = gl.filter(g => ev(q.having, gctx(g)) === true);
      sel.forEach(s => {
        if (s.e.t === 'col') {
          const grouped = q.group.some(g => g.t === 'col' && g.n.toLowerCase() === s.e.n.toLowerCase() && (!g.q || !s.e.q || g.q.toLowerCase() === s.e.q.toLowerCase()));
          if (!grouped) throw err('Столбец «' + s.e.n + '» нужно добавить в GROUP BY или обернуть агрегатной функцией (COUNT, SUM, AVG, MIN, MAX).');
        }
      });
      out = gl.map(g => ({ vals: sel.map(s => ev(s.e, gctx(g))), ctx: g }));
    } else {
      out = rows.map(r => ({ vals: sel.map(s => ev(s.e, makeCtx(aliasCols, r, null))), ctx: r }));
    }
    if (q.order.length) {
      const names = sel.map(s => s.name.toLowerCase());
      const keyOf = (o, ob) => {
        if (ob.e.t === 'num') { const k = ob.e.v - 1; if (!(k >= 0 && k < sel.length)) throw err('В ORDER BY номер столбца вне диапазона.'); return o.vals[k]; }
        if (ob.e.t === 'col' && !ob.e.q) { const k = names.indexOf(ob.e.n.toLowerCase()); if (k >= 0) return o.vals[k]; }
        return aggregated ? ev(ob.e, makeCtx(aliasCols, o.ctx[0] || {}, o.ctx)) : ev(ob.e, makeCtx(aliasCols, o.ctx, null));
      };
      const cmpv = (a, b) => (isNull(a) && isNull(b)) ? 0 : isNull(a) ? -1 : isNull(b) ? 1 : (a < b ? -1 : a > b ? 1 : 0);
      const keyed = out.map((o, i) => ({ o, i, k: q.order.map(ob => keyOf(o, ob)) }));
      keyed.sort((x, y) => { for (let n = 0; n < q.order.length; n++) { const r = cmpv(x.k[n], y.k[n]); if (r) return q.order[n].desc ? -r : r; } return x.i - y.i; });
      out = keyed.map(x => x.o);
    }
    let resRows = out.map(o => o.vals);
    if (q.distinct) { const seen = new Set(); resRows = resRows.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
    if (q.limit !== null) resRows = resRows.slice(0, q.limit);
    return { cols: sel.map(s => s.name), rows: resRows };
  }

  const norm = v => isNull(v) ? 'NULL' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
  /* Сравнение результатов: названия столбцов не важны, порядок строк важен только при ordered. */
  function same(a, b, ordered) {
    if (a.cols.length !== b.cols.length || a.rows.length !== b.rows.length) return false;
    const ra = a.rows.map(r => r.map(norm).join('\u0001')), rb = b.rows.map(r => r.map(norm).join('\u0001'));
    if (ordered) return ra.every((x, i) => x === rb[i]);
    return ra.slice().sort().join('\u0002') === rb.slice().sort().join('\u0002');
  }
  /* Подсказка, чем результат отличается от ожидаемого. Пустая строка значит «совпало». */
  function diff(got, want, ordered) {
    if (got.cols.length !== want.cols.length) return 'Число столбцов в результате ' + got.cols.length + ', а нужно ' + want.cols.length + '.';
    if (got.rows.length !== want.rows.length) return 'Строк в результате ' + got.rows.length + ', а нужно ' + want.rows.length + '.';
    if (!same(got, want, false)) return 'Число строк и столбцов верное, но значения отличаются. Проверьте условия, соединения и агрегаты.';
    if (ordered && !same(got, want, true)) return 'Значения верные, но порядок строк другой. Проверьте ORDER BY.';
    return '';
  }
  const fmtVal = v => isNull(v) ? 'NULL' : (typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v));

  return { tokenize, parse, run, same, diff, fmtVal };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SQL;
