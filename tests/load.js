'use strict';
/* Помощник тестов: загружает те же скрипты в том же порядке, что и index.html, в изолированный контекст vm. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

/* Берёт порядок подключения из index.html, чтобы тесты не расходились с реальной страницей. */
function scriptList() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(f => f !== 'js/start.js');
}

function loadCourse() {
  const files = scriptList();
  const src = files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');
  const tail = `
;registerLabs();registerSqlLabs();
({ COURSE, CARDS, GLOSS, WIDGETS, SOURCES, BPMN_TASKS, SQL_TASKS, SQL_DB, BPMN, SQL, UML, PARTS,
   lib: { esc, plural, parseNum, fmt, normFill, fillOk, sameSet, riceScore, fresh, sanitizeState, serializeState, parseImport, mergeStates, LIMITS, APP_ID, LS_KEY, doneCount } })`;
  const ctx = vm.runInNewContext(src + tail, {});
  ctx.files = files;
  return ctx;
}

module.exports = { root, loadCourse, scriptList };
