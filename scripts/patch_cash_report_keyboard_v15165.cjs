const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const changelogPath = path.join(root, 'CHANGELOG.md');
const testPath = path.join(root, 'tests/fox/cash_report_keyboard.test.cjs');

let source = fs.readFileSync(indexPath, 'utf8');

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(from, to);
}

source = replaceOnce(
  source,
  "<title>FO'X App v15.16.4 — COMPACT PDF UPLOAD</title>",
  "<title>FO'X App v15.16.5 — CASH REPORT KEYBOARD DISMISS</title>",
  'version title'
);

const anchor = "const CASH_REPORT_RECOGNITION_MAX_WAIT_MS=45000;\n";
const keyboardBlock = `const CASH_REPORT_RECOGNITION_MAX_WAIT_MS=45000;\nconst CASH_REPORT_EDITOR_SELECTOR='input, textarea, select, [contenteditable=\"true\"]';\nconst CASH_REPORT_INTERACTIVE_SELECTOR='input, textarea, select, button, a, label, [contenteditable=\"true\"]';\n\nfunction cashReportActiveEditor_(){\n  const active=document.activeElement;\n  const screen=document.getElementById('cashReportScreen');\n  return active&&screen&&screen.contains(active)&&active.matches&&active.matches(CASH_REPORT_EDITOR_SELECTOR)?active:null;\n}\nfunction setCashReportTelegramVerticalSwipes_(editing){\n  if(!TG)return;\n  try{\n    if(editing&&typeof TG.enableVerticalSwipes==='function')TG.enableVerticalSwipes();\n    else if(!editing&&typeof TG.disableVerticalSwipes==='function')TG.disableVerticalSwipes();\n  }catch(e){}\n}\nfunction blurCashReportEditor_(){\n  const active=cashReportActiveEditor_();\n  if(!active)return false;\n  active.blur();\n  return true;\n}\nfunction cashReportOutsideInteraction_(event){\n  const active=cashReportActiveEditor_();\n  if(!active)return;\n  const target=event&&event.target;\n  if(target&&target.closest&&target.closest(CASH_REPORT_INTERACTIVE_SELECTOR))return;\n  blurCashReportEditor_();\n}\nfunction installCashReportKeyboardDismiss_(){\n  const screen=document.getElementById('cashReportScreen');\n  if(!screen||screen.dataset.keyboardDismissBound==='1')return;\n  screen.dataset.keyboardDismissBound='1';\n  screen.addEventListener('focusin',event=>{\n    const target=event&&event.target;\n    if(target&&target.matches&&target.matches(CASH_REPORT_EDITOR_SELECTOR))setCashReportTelegramVerticalSwipes_(true);\n  });\n  screen.addEventListener('focusout',()=>{\n    setTimeout(()=>{if(!cashReportActiveEditor_())setCashReportTelegramVerticalSwipes_(false);},0);\n  });\n  if(window.PointerEvent)screen.addEventListener('pointerdown',cashReportOutsideInteraction_,{capture:true});\n  else screen.addEventListener('touchend',cashReportOutsideInteraction_,{capture:true,passive:true});\n}\n`;
source = replaceOnce(source, anchor, keyboardBlock, 'cash report keyboard helper anchor');

source = replaceOnce(
  source,
  "document.getElementById('cashReportSend').addEventListener('click',sendCashReportToTelegram);\n\nswitchTab(DATA[0].id);",
  "document.getElementById('cashReportSend').addEventListener('click',sendCashReportToTelegram);\ninstallCashReportKeyboardDismiss_();\n\nswitchTab(DATA[0].id);",
  'cash report keyboard init'
);

fs.writeFileSync(indexPath, source);

let changelog = fs.readFileSync(changelogPath, 'utf8');
const changelogAnchor = '## Unreleased\n\n';
const changelogEntry = '- FO’X `v15.16.5`: исправлено залипание клавиатуры в кассовом отчёте внутри Telegram Mini App. Пока поле кассового отчёта в фокусе, frontend временно возвращает нативные vertical swipes Telegram WebApp, а tap по пустой области формы снимает focus через `blur()` без `preventDefault`/`stopPropagation`. Делегированный обработчик покрывает статические и динамически добавляемые поля; ввод и расчёты остаются на существующих `input`/`change` обработчиках.\n\n';
if (!changelog.includes(changelogEntry)) {
  changelog = replaceOnce(changelog, changelogAnchor, changelogAnchor + changelogEntry, 'changelog unreleased anchor');
}
fs.writeFileSync(changelogPath, changelog);

const testSource = `const assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst test = require('node:test');\n\nconst source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');\nconst start = source.indexOf("const CASH_REPORT_EDITOR_SELECTOR=");\nconst end = source.indexOf('function openCashReportSection()', start);\nconst keyboard = source.slice(start, end);\n\ntest('FO’X cash report installs delegated keyboard dismissal for every editor', () => {\n  assert.ok(start >= 0 && end > start, 'cash report keyboard block not found');\n  assert.ok(keyboard.includes("CASH_REPORT_EDITOR_SELECTOR='input, textarea, select, [contenteditable="));\n  assert.match(keyboard, /screen\.addEventListener\('focusin'/);\n  assert.match(keyboard, /window\.PointerEvent\).*pointerdown/);\n  assert.match(keyboard, /touchend'.*capture:true,passive:true/);\n  assert.match(source, /installCashReportKeyboardDismiss_\(\);/);\n});\n\ntest('tap outside a cash report editor blurs focus without blocking native gestures', () => {\n  assert.match(keyboard, /function cashReportOutsideInteraction_\(event\)/);\n  assert.match(keyboard, /target\.closest\(CASH_REPORT_INTERACTIVE_SELECTOR\)/);\n  assert.match(keyboard, /blurCashReportEditor_\(\);/);\n  assert.doesNotMatch(keyboard, /preventDefault\s*\(/);\n  assert.doesNotMatch(keyboard, /stopPropagation\s*\(/);\n});\n\ntest('Telegram vertical swipes are enabled only while a cash report editor is focused', () => {\n  assert.match(keyboard, /TG\.enableVerticalSwipes\(\)/);\n  assert.match(keyboard, /TG\.disableVerticalSwipes\(\)/);\n  assert.match(keyboard, /focusout[\\s\\S]*?setTimeout\(\(\)=>\{if\(!cashReportActiveEditor_\(\)\)setCashReportTelegramVerticalSwipes_\(false\);\},0\)/);\n});\n\ntest('cash report values keep their existing input-driven recalculation', () => {\n  assert.match(source, /function bindCashReportInputs\(\)[\\s\\S]*?el\.oninput=refreshCashReportMessage;el\.onchange=refreshCashReportMessage/);\n  assert.match(source, /input\.oninput=\(\)=>\{slip\.amount=Number\(input\.value\)\|\|0;refreshCashReportMessage\(\);\}/);\n  assert.match(source, /\[data-amount\]'\)\.oninput=e=>\{p\.amount=Number\(e\.target\.value\)\|\|0;refreshCashReportMessage\(\);\}/);\n});\n`;
fs.writeFileSync(testPath, testSource);
