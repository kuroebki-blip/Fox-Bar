/**
 * Dedicated FO'X repair webhook handler for the stock Apps Script project.
 *
 * Expected doPost routing in Code.gs:
 *   if (action === 'telegramRepairWebhook') return handleFoxRepairTelegramWebhook_(e);
 *
 * The public Telegram endpoint is the Cloudflare Worker. The Worker forwards
 * the raw Telegram update here and adds the shared secret as ?secret=...
 */
function handleFoxRepairTelegramWebhook_(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = String(props.getProperty('TELEGRAM_REPAIR_WEBHOOK_SECRET') || '');
  const actualSecret = String(e && e.parameter && e.parameter.secret || '');

  if (!expectedSecret || !constantTimeEqual_(expectedSecret, actualSecret)) {
    return textOutput_({ ok:false, error:'unauthorized' });
  }

  let update;
  try {
    update = JSON.parse(String(e && e.postData && e.postData.contents || '{}'));
  } catch (_) {
    return textOutput_({ ok:true, ignored:true, reason:'invalid_update' });
  }

  try {
    const handled = foxRepairHandleTelegramUpdate_(update);
    return textOutput_({
      ok: true,
      handled: handled ? 'repair' : 'ignored'
    });
  } catch (err) {
    try {
      foxRepairDiagnosticSet_('repair_webhook_exception', {
        updateId: String(update && update.update_id || ''),
        callbackData: String(update && update.callback_query && update.callback_query.data || ''),
        error: errorText_(err)
      });
    } catch (_) {}

    // The ingress Worker already acknowledged Telegram. Return a successful
    // body here as well and keep the real failure in diagnostics.
    return textOutput_({ ok:true, handled:'error_logged' });
  }
}
