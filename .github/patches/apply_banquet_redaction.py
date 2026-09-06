from pathlib import Path

code_path = Path('apps-script/stock/production/Code.gs')
code = code_path.read_text()

anchor = "function buildEstimateGuruBanquetComment_(data, message, snapshotUrl) {\n"
guard = """function redactBanquetContactData_(value) {\n  return String(value || '')\n    .replace(/\\+?\\d[\\d\\s().-]{8,}\\d/g, '')\n    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, '')\n    .replace(/\\s{2,}/g, ' ')\n    .trim();\n}\n\n"""
if 'function redactBanquetContactData_' not in code:
    if anchor not in code:
        raise SystemExit('comment builder anchor not found')
    code = code.replace(anchor, guard + anchor, 1)

old = "const sourceText = String(message && (message.text || message.caption) || '').replace(/https:\\/\\/app\\.estimates\\.guru\\/snapshot\\/[A-Za-z0-9_-]{6,128}(?:[/?#][^\\s<>]*)?/ig, '').replace(/\\n{3,}/g, '\\n\\n').trim();"
new = "const sourceText = redactBanquetContactData_(String(message && (message.text || message.caption) || '').replace(/https:\\/\\/app\\.estimates\\.guru\\/snapshot\\/[A-Za-z0-9_-]{6,128}(?:[/?#][^\\s<>]*)?/ig, '').replace(/\\n{3,}/g, '\\n\\n'));"
if old not in code:
    raise SystemExit('sourceText anchor not found')
code = code.replace(old, new, 1)

old_guest = "guestName:String(parsed.guest_name || '').trim(), guestCount:Math.max(0, Math.round(number_(parsed.guest_count))), eventType:String(parsed.event_type || '').trim(),"
new_guest = "guestName:redactBanquetContactData_(parsed.guest_name), guestCount:Math.max(0, Math.round(number_(parsed.guest_count))), eventType:redactBanquetContactData_(parsed.event_type),"
if old_guest not in code:
    raise SystemExit('guest anchor not found')
code = code.replace(old_guest, new_guest, 1)

old_item = "category:String(item && item.category || '').trim(), name:String(item && item.name || '').trim(),"
new_item = "category:redactBanquetContactData_(item && item.category), name:redactBanquetContactData_(item && item.name),"
if old_item not in code:
    raise SystemExit('order item anchor not found')
code = code.replace(old_item, new_item, 1)

old_reserve = "return { rawName:String(item && item.raw_name || '').trim(), quantity:number_(item && item.quantity), unit:String(item && item.unit || '').trim(), suggestedStockName:String(item && item.suggested_stock_name || '').trim(), notes:String(item && item.notes || '').trim() };"
new_reserve = "return { rawName:redactBanquetContactData_(item && item.raw_name), quantity:number_(item && item.quantity), unit:String(item && item.unit || '').trim(), suggestedStockName:String(item && item.suggested_stock_name || '').trim(), notes:redactBanquetContactData_(item && item.notes) };"
if old_reserve not in code:
    raise SystemExit('reserve item anchor not found')
code = code.replace(old_reserve, new_reserve, 1)

old_ignored = "ignored:Array.isArray(parsed.ignored) ? parsed.ignored.map(String).filter(Boolean) : []"
new_ignored = "ignored:Array.isArray(parsed.ignored) ? parsed.ignored.map(redactBanquetContactData_).filter(Boolean) : []"
if old_ignored not in code:
    raise SystemExit('ignored anchor not found')
code = code.replace(old_ignored, new_ignored, 1)
code_path.write_text(code)

test_path = Path('tests/banquets/v16_banquets_upgrade.test.js')
tests = test_path.read_text()
extra = r'''

test('контактные данные вырезаются перед сохранением комментария банкета', () => {
  const { context } = makeRuntime();
  const syntheticContact = '+' + ['7','900','000','00','00'].join(' ');
  const redacted = context.redactBanquetContactData_('бронь ' + syntheticContact + ' test@example.com');
  assert.equal(redacted.includes('900'), false);
  assert.equal(redacted.includes('@'), false);
});
'''
if 'контактные данные вырезаются перед сохранением комментария банкета' not in tests:
    tests += extra
test_path.write_text(tests)
