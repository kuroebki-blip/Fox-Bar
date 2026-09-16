export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    const telegramSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (env.TELEGRAM_WEBHOOK_SECRET && telegramSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let bodyText;
    try {
      bodyText = await request.text();
      JSON.parse(bodyText);
    } catch (_) {
      return new Response('Bad Request', { status: 400 });
    }

    ctx.waitUntil(forwardToAppsScript(bodyText, env));

    return new Response('OK', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    });
  }
};

async function forwardToAppsScript(bodyText, env) {
  const baseUrl = String(env.GOOGLE_APPS_SCRIPT_URL || '').trim();
  const appsScriptSecret = String(env.GOOGLE_APPS_SCRIPT_SECRET || '').trim();

  if (!baseUrl) throw new Error('GOOGLE_APPS_SCRIPT_URL is missing');
  if (!appsScriptSecret) throw new Error('GOOGLE_APPS_SCRIPT_SECRET is missing');

  const url = new URL(baseUrl);
  url.searchParams.set('action', 'telegramRepairWebhook');
  url.searchParams.set('secret', appsScriptSecret);

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: bodyText,
        redirect: 'follow'
      });

      if (response.ok) return;

      lastError = new Error(
        `Apps Script HTTP ${response.status}: ${await response.text()}`
      );
    } catch (error) {
      lastError = error;
    }

    await sleep(attempt * 1000);
  }

  console.error('Apps Script forwarding failed', lastError);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
