const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '../../tatooine/app.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../../tatooine/index.html'), 'utf8');

test('Tatooine uses the on-demand shared scanner before adding a cash-report page', () => {
  const prepareStart = app.indexOf('async function preparePage(file)');
  const prepareEnd = app.indexOf('async function rotateDataUrl(', prepareStart);
  const prepare = app.slice(prepareStart, prepareEnd);

  assert.match(page, /shared\/document-scanner\/geometry\.js/);
  assert.match(page, /shared\/document-scanner\/document-scanner\.js/);
  assert.match(prepare, /const Scanner = window\.DocumentScanner/);
  assert.match(prepare, /new Scanner\(\{ maxLongSide: 1800/);
  assert.match(prepare, /\.process\(file,\{title:'Проверь документ',confirm:'Использовать скан'\}\)/);
  assert.doesNotMatch(app, /DocumentScanner\.warmup/);
});

test('Tatooine sends a compact coherent image to cash OCR, matching FO’X limits', () => {
  const ocrStart = app.indexOf('async function toOcrImage(page)');
  const ocrEnd = app.indexOf('async function buildOcrImages(', ocrStart);
  const ocr = app.slice(ocrStart, ocrEnd);

  assert.match(ocr, /2200\s*\/\s*Math\.max\(rawWidth, rawHeight\)/);
  assert.match(ocr, /canvasToJpeg\(canvas, \.84\)/);
  assert.match(ocr, /context\.drawImage\(image, 0, 0, width, height\)/);
  assert.doesNotMatch(app, /function cashOcrMontageSpec/);
});
