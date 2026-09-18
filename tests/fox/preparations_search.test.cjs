const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

test('hub opens preparations instead of the former checklists section', () => {
  assert.match(html, /<title>FO'X App v15\.16\.8 — PREPARATIONS SEARCH<\/title>/);
  assert.match(html, /data-open-section="preparations"/);
  assert.match(html, />Заготовки</);
  assert.doesNotMatch(html, /data-open-section="checklists"/);
});

test('only the preparations dataset is rendered and its search covers recipe content', () => {
  assert.match(html, /const VISIBLE_SECTIONS=DATA\.filter\(sec=>sec\.id==='prep'\);/);
  assert.match(html, /function preparationSearchText_\(it\)/);
  assert.match(html, /it\.r\.ing/);
  assert.match(html, /it\.r\.method/);
  assert.match(html, /id="preparationsSearch"/);
  assert.match(html, /aria-label="Поиск по заготовкам"/);
});

test('filtering is local and does not remove recipe actions or preparation state', () => {
  assert.match(html, /function applyPreparationsSearch\(\)/);
  assert.match(html, /row\.hidden=!matches;/);
  assert.match(html, /openRecipe\(it\)/);
  assert.match(html, /state\[it\._id\]\.checked/);
});
