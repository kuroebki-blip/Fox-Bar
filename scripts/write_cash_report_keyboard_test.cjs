const fs = require('node:fs');
const path = require('node:path');

const testPath = path.join(__dirname, '..', 'tests/fox/cash_report_keyboard.test.cjs');
const content = `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const start = source.indexOf("const CASH_REPORT_EDITOR_SELECTOR=");
const end = source.indexOf('function openCashReportSection()', start);
const keyboard = source.slice(start, end);

test('FO’X cash report installs delegated keyboard dismissal for every editor', () => {
  assert.ok(start >= 0 && end > start, 'cash report keyboard block not found');
  assert.ok(keyboard.includes("CASH_REPORT_EDITOR_SELECTOR='input, textarea, select, [contenteditable="));
  assert.ok(keyboard.includes("screen.addEventListener('focusin'"));
  assert.ok(keyboard.includes("screen.addEventListener('pointerdown',cashReportOutsideInteraction_,{capture:true})"));
  assert.ok(keyboard.includes("screen.addEventListener('touchend',cashReportOutsideInteraction_,{capture:true,passive:true})"));
  assert.ok(source.includes('installCashReportKeyboardDismiss_();'));
});

test('tap outside a cash report editor blurs focus without blocking native gestures', () => {
  assert.ok(keyboard.includes('function cashReportOutsideInteraction_(event)'));
  assert.ok(keyboard.includes('target.closest(CASH_REPORT_INTERACTIVE_SELECTOR)'));
  assert.ok(keyboard.includes('blurCashReportEditor_();'));
  assert.equal(keyboard.includes('preventDefault('), false);
  assert.equal(keyboard.includes('stopPropagation('), false);
});

test('Telegram vertical swipes are enabled only while a cash report editor is focused', () => {
  assert.ok(keyboard.includes('TG.enableVerticalSwipes()'));
  assert.ok(keyboard.includes('TG.disableVerticalSwipes()'));
  assert.ok(keyboard.includes("screen.addEventListener('focusout'"));
  assert.ok(keyboard.includes('if(!cashReportActiveEditor_())setCashReportTelegramVerticalSwipes_(false)'));
});

test('cash report values keep their existing input-driven recalculation', () => {
  assert.ok(source.includes('el.oninput=refreshCashReportMessage;el.onchange=refreshCashReportMessage'));
  assert.ok(source.includes('input.oninput=()=>{slip.amount=Number(input.value)||0;refreshCashReportMessage();}'));
  assert.ok(source.includes("row.querySelector('[data-amount]').oninput=e=>{p.amount=Number(e.target.value)||0;refreshCashReportMessage();}"));
});
`;

fs.mkdirSync(path.dirname(testPath), { recursive: true });
fs.writeFileSync(testPath, content);
