'use strict';
/* Охраняет публичный репозиторий от личных следов, длинных тире и внешних запросов.
   Стоп-слова хранятся в закодированном виде, чтобы сам этот файл оставался чистым. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root, loadCourse } = require('./load');

const STOP = Buffer.from('Q2hpcCBDYXJkCkFTRUUKQXNzZWNjbwpVbmxpbWl0ClJhbWJsZXIKRG90bwpTcGFjZTMwNwpTdW1TdWIKS2FzaGl0c3luYQpCZWxncmFkZQp2YWNhbmN5CnJlY3J1aXRlcgpsZWFybmluZy10cmFjawpDbGF1ZGUKQW50aHJvcGljCkNvLUF1dGhvcmVkClNhbGVzZm9yY2UKVGF0aWFuYQrQmtCw0YjQuNGG0YvQvQrQotCw0YLRjNGP0L0K0JHQtdC70LPRgNCw0LQKdGthc2hpdHN5bmEKZ21haWwKcHVycmZlY3RwYW5kYQpGcmVlZG9tClBheXNlbmdlcg==', 'base64').toString('utf8').split('\n');
const STOP_RE = STOP.map(w => ({ w, re: new RegExp('(^|[^A-Za-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*') + '($|[^A-Za-z0-9])', 'i') }));
const TEXT_EXT = new Set(['.js', '.html', '.css', '.md', '.json', '.yml', '.yaml', '.txt', '']);

function trackedTextFiles() {
  let list;
  try {
    list = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (e) { list = null; }
  if (!list) {
    list = [];
    const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).forEach(e => {
      const rel = d ? d + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!['.git', 'node_modules', 'notes', '.playwright-mcp'].includes(e.name)) walk(rel); } else list.push(rel);
    });
    walk('');
  }
  return list.filter(f => TEXT_EXT.has(path.extname(f).toLowerCase()) && fs.existsSync(path.join(root, f)));
}
const files = trackedTextFiles();
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('есть что проверять', () => {
  assert.ok(files.length > 20, 'найдено ' + files.length);
  assert.ok(files.includes('index.html'));
});

test('нет длинных и средних тире ни в одном текстовом файле', () => {
  const bad = files.filter(f => /[\u2013\u2014\u2015]/.test(read(f)));
  assert.deepEqual(Array.from(bad), []);
});

test('нет двойного дефиса как тире в прозе и тире из пробелов вокруг дефиса в тексте курса', () => {
  const { COURSE, CARDS, GLOSS } = loadCourse();
  const strip = h => String(h).replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<code>[\s\S]*?<\/code>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ');
  const texts = [];
  for (const m of COURSE) {
    texts.push([m.id + ' lead', m.lead], [m.id + ' body', m.body], [m.id + ' practice', m.practice.brief + ' ' + m.practice.model + ' ' + m.practice.template + ' ' + m.practice.checks.join(' ')]);
    m.learn.concat(m.takeaways).forEach((x, i) => texts.push([m.id + ' list' + i, x]));
    m.quiz.forEach((q, i) => texts.push([m.id + ' q' + i, q.q + ' ' + q.why + ' ' + (q.o || []).join(' ') + ' ' + (q.items || []).join(' ')]));
  }
  CARDS.forEach(c => texts.push(['card ' + c.id, c.q + ' ' + c.a]));
  GLOSS.forEach(g => texts.push(['gloss ' + g.t, g.d]));
  const bad = [];
  for (const [where, t] of texts) {
    const s = strip(t);
    if (/(^|\s)[-]{2,}(\s|$)/.test(s) || /\s-\s/.test(s)) bad.push(where + ': ' + (s.match(/.{0,25}(\s-\s|\s--\s).{0,25}/) || [''])[0]);
  }
  assert.deepEqual(Array.from(bad), []);
});

test('нет следов автора, работодателей, вакансий и инструментов (стоп-слова)', () => {
  const hits = [];
  for (const f of files) {
    const text = read(f);
    for (const s of STOP_RE) if (s.re.test(text)) hits.push(f + ': стоп-слово №' + STOP.indexOf(s.w));
  }
  assert.deepEqual(Array.from(hits), []);
});

test('в тексте нет заготовок и незавершённых мест', () => {
  const bad = files.filter(f => /\b(TODO|FIXME|XXX)\b|lorem ipsum|stub/i.test(read(f)) && !/tests[\\/]/.test(f));
  assert.deepEqual(Array.from(bad), []);
});

test('страница и стили не обращаются к другим сайтам', () => {
  const html = read('index.html');
  const css = read('assets/styles.css') + read('assets/fonts.css');
  const bad = (html.match(/(?:src|href)="https?:\/\/[^"]+"/g) || []).filter(x => !/panipanda\.github\.io/.test(x));
  assert.deepEqual(Array.from(bad), []);
  assert.deepEqual(css.match(/url\(["']?https?:/g) || [], []);
  for (const f of files.filter(x => x.startsWith('js/'))) {
    const t = read(f);
    assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|importScripts)\s*\(/.test(t) && !/\bnew\s+(WebSocket|EventSource)\b/.test(t), f + ' обращается к сети');
  }
});

test('шрифты и лицензии на месте', () => {
  for (const f of ['LICENSE', 'LICENSE-CONTENT.md', 'assets/fonts/OFL.txt', 'assets/fonts/ibm-plex-sans-cyrillic-400-normal.woff2', 'assets/fonts/ibm-plex-sans-latin-400-normal.woff2', 'assets/fonts/ibm-plex-mono-cyrillic-400-normal.woff2']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});
