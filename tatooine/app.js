(() => {
  'use strict';

  const CONFIG = window.TATOOINE_CONFIG || {};
  const API_URL = String(CONFIG.apiUrl || '');
  const TG = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  let pages = [];
  let jobId = '';
  let result = null;
  let terminalSlips = [];
  let prepayments = [];
  let pollingToken = 0;

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[char]);
  }

  function haptic(kind) {
    try {
      if (!TG || !TG.HapticFeedback) return;
      if (kind === 'selection') TG.HapticFeedback.selectionChanged();
      else if (kind === 'success') TG.HapticFeedback.notificationOccurred('success');
      else TG.HapticFeedback.impactOccurred('light');
    } catch (_) {}
  }

  function telegramUser() {
    try { return TG && TG.initDataUnsafe && TG.initDataUnsafe.user ? TG.initDataUnsafe.user : null; }
    catch (_) { return null; }
  }

  function authParams() {
    const user = telegramUser();
    let chat = null;
    try { chat = TG && TG.initDataUnsafe ? TG.initDataUnsafe.chat : null; } catch (_) {}
    return {
      telegramUserId: user && user.id ? String(user.id) : '',
      telegramUserName: user ? ([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id || '')) : '',
      telegramChatId: chat && chat.id ? String(chat.id) : '',
      telegramInitData: TG ? String(TG.initData || '') : ''
    };
  }

  function apiConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(API_URL);
  }

  function jsonp(params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const callback = '__tatooineCashCb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      const query = new URLSearchParams(Object.assign({}, params, { callback, _: Date.now() }));
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(null, new Error('Сервер не ответил вовремя.')), timeoutMs);
      function finish(data, error) {
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) { window[callback] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        if (error) reject(error); else resolve(data);
      }
      window[callback] = data => finish(data, null);
      script.onerror = () => finish(null, new Error('Не удалось подключиться к обработчику.'));
      script.src = API_URL + '?' + query.toString();
      document.body.appendChild(script);
    });
  }

  function post(fields) {
    const data = new FormData();
    Object.entries(Object.assign({}, fields, authParams())).forEach(([key, value]) => data.append(key, value == null ? '' : value));
    return fetch(API_URL, { method: 'POST', mode: 'no-cors', body: data });
  }

  function setStatus(type, text, progress = 0) {
    const status = $('cashReportStatus');
    status.className = 'status ' + (type || '');
    status.innerHTML = escapeHtml(text) + '<div class="progress"><i id="cashReportProgress"></i></div>';
    const bar = $('cashReportProgress');
    if (bar) bar.style.width = Math.max(0, Math.min(100, Math.round(Number(progress || 0) * 100))) + '%';
  }

  // ===== TATOOINE TESTABLE HELPERS START =====
  function base64DecodedBytes(value) {
    const clean = String(value || '').replace(/\s+/g, '');
    if (!clean) return 0;
    const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
  }

  function validateOcrImages(images) {
    const list = Array.isArray(images) ? images : [];
    const maxPages = Number(CONFIG.maxOcrPages) || 20;
    const maxImageBytes = Number(CONFIG.maxOcrImageBytes) || 6 * 1024 * 1024;
    const maxTotalBytes = Number(CONFIG.maxOcrTotalBytes) || 12 * 1024 * 1024;
    if (!list.length) throw new Error('Добавьте хотя бы одну фотографию.');
    if (list.length > maxPages) throw new Error('Слишком много фотографий. Максимум ' + maxPages + '.');
    let totalBytes = 0;
    list.forEach((image, index) => {
      const bytes = base64DecodedBytes(image && image.data);
      if (bytes < 100) throw new Error('Фотография ' + (index + 1) + ' пустая.');
      if (bytes > maxImageBytes) throw new Error('Фотография ' + (index + 1) + ' слишком большая.');
      totalBytes += bytes;
    });
    if (totalBytes > maxTotalBytes) throw new Error('Общий размер фотографий больше 12 МБ. Уменьшите их количество.');
    return { pages: list.length, totalBytes };
  }
  // ===== TATOOINE TESTABLE HELPERS END =====

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Не удалось прочитать фотографию.'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl, errorMessage) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(errorMessage || 'Не удалось открыть изображение.'));
      image.src = dataUrl;
    });
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
      if (!canvas.toBlob) {
        try { resolve(canvas.toDataURL('image/jpeg', quality)); } catch (error) { reject(error); }
        return;
      }
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Не удалось сохранить фотографию.')); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Не удалось подготовить фотографию.'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', quality);
    });
  }

  async function preparePage(file) {
    const raw = await readFileAsDataUrl(file);
    const image = await loadImage(raw, 'Не удалось открыть фото. Используйте JPG/PNG или сделайте скриншот.');
    const rawWidth = image.naturalWidth || image.width;
    const rawHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, 3400 / Math.max(rawWidth, rawHeight));
    const width = Math.max(1, Math.round(rawWidth * scale));
    const height = Math.max(1, Math.round(rawHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return { id: 'page_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), dataUrl: await canvasToJpeg(canvas, .94), width, height };
  }

  async function rotateDataUrl(dataUrl) {
    const image = await loadImage(dataUrl, 'Не удалось повернуть фотографию.');
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const canvas = document.createElement('canvas');
    canvas.width = sourceHeight;
    canvas.height = sourceWidth;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
    return { dataUrl: await canvasToJpeg(canvas, .94), width: canvas.width, height: canvas.height };
  }

  async function toOcrImage(page) {
    const image = await loadImage(page.dataUrl, 'Не удалось подготовить фотографию для OCR.');
    const rawWidth = image.naturalWidth || image.width;
    const rawHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, 1800 / Math.max(rawWidth, rawHeight));
    const width = Math.max(1, Math.round(rawWidth * scale));
    const height = Math.max(1, Math.round(rawHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = await canvasToJpeg(canvas, .82);
    return { mimeType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), width, height };
  }

  async function buildOcrImages(snapshot) {
    const images = [];
    for (let index = 0; index < snapshot.length; index += 1) {
      setStatus('', 'Подготавливаю фото ' + (index + 1) + ' из ' + snapshot.length + '…', .05 + .1 * index / Math.max(1, snapshot.length));
      images.push(await toOcrImage(snapshot[index]));
    }
    validateOcrImages(images);
    return images;
  }

  function invalidateRecognition() {
    pollingToken += 1;
    jobId = '';
    result = null;
    terminalSlips = [];
    prepayments = [];
    $('cashReportResultCard').hidden = true;
    resetSendButton();
  }

  async function appendFiles(fileList) {
    const files = Array.from(fileList || []).filter(file => String(file.type || '').startsWith('image/'));
    if (!files.length) return;
    invalidateRecognition();
    setStatus('', 'Подготавливаю фотографии…', .04);
    try {
      for (const file of files) pages.push(await preparePage(file));
      renderPages();
      setStatus('', 'Фотографии готовы. Проверьте порядок и нажмите «Распознать отчёт».');
    } catch (error) {
      setStatus('err', String(error && error.message ? error.message : error));
    }
  }

  function renderPages() {
    const root = $('cashReportPages');
    root.innerHTML = '';
    pages.forEach((page, index) => {
      const card = document.createElement('div');
      card.className = 'page';
      card.innerHTML = '<span class="page-num">' + (index + 1) + '</span><img src="' + page.dataUrl + '" alt="Фото ' + (index + 1) + '"><div class="page-actions"><button data-up type="button" ' + (index === 0 ? 'disabled' : '') + '>↑</button><button data-down type="button" ' + (index === pages.length - 1 ? 'disabled' : '') + '>↓</button><button data-rotate type="button">↻</button><button class="del" data-delete type="button">✕</button></div>';
      card.querySelector('[data-up]').onclick = () => movePage(index, -1);
      card.querySelector('[data-down]').onclick = () => movePage(index, 1);
      card.querySelector('[data-rotate]').onclick = () => rotatePage(index);
      card.querySelector('[data-delete]').onclick = () => {
        pages.splice(index, 1);
        invalidateRecognition();
        renderPages();
      };
      root.appendChild(card);
    });
    $('cashReportPageSummary').textContent = pages.length ? 'Фотографий: ' + pages.length + '. Можно распознавать.' : 'Фотографий пока нет.';
    $('cashReportRecognize').disabled = !pages.length;
  }

  function movePage(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    [pages[index], pages[target]] = [pages[target], pages[index]];
    invalidateRecognition();
    renderPages();
    haptic('selection');
  }

  async function rotatePage(index) {
    if (!pages[index]) return;
    try {
      setStatus('', 'Поворачиваю фотографию…', .05);
      const rotated = await rotateDataUrl(pages[index].dataUrl);
      pages[index] = Object.assign({}, pages[index], rotated);
      invalidateRecognition();
      renderPages();
      setStatus('', 'Фотография повёрнута.');
    } catch (error) {
      setStatus('err', String(error && error.message ? error.message : error));
    }
  }

  function resetAll() {
    pages = [];
    invalidateRecognition();
    renderPages();
    setStatus('', 'Добавьте фотографии отчёта iiko и всех терминальных слипов.');
  }

  async function pollJob(expectedJobId, finalStatuses, maxMs) {
    const token = ++pollingToken;
    const started = Date.now();
    let notFound = 0;
    while (Date.now() - started < maxMs) {
      if (token !== pollingToken || expectedJobId !== jobId) throw new Error('Операция отменена.');
      try {
        const response = await jsonp(Object.assign({ action: 'status', jobId: expectedJobId }, authParams()));
        if (response && response.ok) {
          setStatus(response.status === 'ERROR' || response.status === 'SEND_ERROR' ? 'err' : '', response.step || 'Обработка…', Number(response.progress) || .2);
          if (finalStatuses.includes(response.status)) return response;
        } else {
          notFound += 1;
          if (notFound > 12 && response && response.error && !String(response.error).includes('не найден')) throw new Error(response.error);
        }
      } catch (error) {
        if (Date.now() - started > 30000 && !String(error && error.message || error).includes('вовремя')) throw error;
      }
      await sleep(2200);
    }
    throw new Error('Сервер отвечает слишком долго. Повторите через минуту.');
  }

  async function recognize() {
    if (!apiConfigured()) { setStatus('err', 'Адрес обработчика не настроен.'); return; }
    if (!pages.length) { setStatus('warn', 'Добавьте хотя бы одну фотографию.'); return; }
    const button = $('cashReportRecognize');
    button.disabled = true;
    try {
      const snapshot = pages.map(page => Object.assign({}, page));
      invalidateRecognition();
      const images = await buildOcrImages(snapshot);
      jobId = 'tatooine_cash_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const activeJobId = jobId;
      setStatus('', 'Передаю фотографии в Gemini…', .15);
      post({ action: 'cashReportScanImages', jobId: activeJobId, pagesCount: snapshot.length, imagesJson: JSON.stringify(images) }).catch(() => {});
      const status = await pollJob(activeJobId, ['DONE', 'ERROR'], 210000);
      if (status.status === 'ERROR') throw new Error(status.error || 'Ошибка распознавания.');
      if (activeJobId !== jobId) throw new Error('Операция отменена.');
      result = status.result || {};
      renderResult(result);
      setStatus('ok', 'Отчёт распознан. Проверьте суммы и сверку терминалов.', 1);
      haptic('success');
    } catch (error) {
      setStatus('err', String(error && error.message ? error.message : error), 1);
    } finally {
      button.disabled = !pages.length;
    }
  }

  function setNumber(id, value) {
    const number = Number(value) || 0;
    $(id).value = number ? String(number) : '';
  }

  function renderResult(data) {
    $('cashReportResultCard').hidden = false;
    $('cashReportDate').value = data.reportDate || '';
    setNumber('cashReportTotalRevenue', data.totalRevenue);
    setNumber('cashReportBankCards', data.bankCards);
    setNumber('cashReportBankCards2', data.bankCards2);
    setNumber('cashReportCashNonFiscal', data.cashNonFiscal);
    setNumber('cashReportCashFiscal', data.cashFiscal);
    setNumber('cashReportCash2', data.cash2);
    setNumber('cashReportTapper', data.tapper);
    setNumber('cashReportSettlement', data.settlementAccount);
    setNumber('cashReportSettlement2', data.settlementAccount2);
    setNumber('cashReportOnlineCashbox2', data.onlineCashbox2);
    $('cashReportExpense').value = '0';
    $('cashReportExpenseComment').value = '';
    setNumber('cashReportCollection', data.collectionAmount);
    setNumber('cashReportCollectionActual', data.collectionActual);
    $('cashReportMorningCash').value = '0';
    $('cashReportChangeFund').value = String(Number(CONFIG.defaultChangeFund) || 0);
    terminalSlips = Array.isArray(data.terminalSlips) ? data.terminalSlips.map((slip, index) => ({ label: String(slip.label || 'Терминал ' + (index + 1)), amount: Number(slip.amount) || 0 })).filter(slip => slip.amount > 0) : [];
    prepayments = [];
    renderSlips();
    renderPrepayments();
    refreshMessage();
    $('cashReportResultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSlips() {
    const root = $('cashReportTerminalSlips');
    root.innerHTML = '';
    terminalSlips.forEach((slip, index) => {
      const row = document.createElement('div');
      row.className = 'slip';
      row.innerHTML = '<label class="field"><span>' + escapeHtml(slip.label) + '</span><input type="number" inputmode="decimal" step="0.01" value="' + escapeHtml(String(slip.amount || '')) + '"></label><button class="remove" type="button">✕</button>';
      row.querySelector('input').oninput = event => { slip.amount = Number(event.target.value) || 0; refreshMessage(); };
      row.querySelector('button').onclick = () => { terminalSlips.splice(index, 1); renderSlips(); refreshMessage(); };
      root.appendChild(row);
    });
    if (!terminalSlips.length) root.innerHTML = '<div class="summary">Слипы не найдены. Добавьте суммы вручную.</div>';
  }

  function addSlip() {
    terminalSlips.push({ label: 'Терминал ' + (terminalSlips.length + 1), amount: 0 });
    renderSlips();
    refreshMessage();
  }

  function renderPrepayments() {
    const root = $('cashReportPrepayments');
    root.innerHTML = '';
    prepayments.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'prepayment';
      row.innerHTML = '<input data-date type="text" inputmode="numeric" placeholder="ДД.ММ.ГГГГ" value="' + escapeHtml(item.date || '') + '"><input data-amount type="number" inputmode="decimal" step="0.01" placeholder="Сумма" value="' + escapeHtml(item.amount ? String(item.amount) : '') + '"><select data-method><option value="cash">Наличными</option><option value="online">Онлайн-касса</option><option value="card">Картой</option><option value="account">Расчётный счёт</option></select><button class="remove" type="button">✕</button>';
      row.querySelector('[data-method]').value = item.method || 'online';
      row.querySelector('[data-date]').oninput = event => { item.date = event.target.value; refreshMessage(); };
      row.querySelector('[data-amount]').oninput = event => { item.amount = Number(event.target.value) || 0; refreshMessage(); };
      row.querySelector('[data-method]').onchange = event => { item.method = event.target.value; refreshMessage(); };
      row.querySelector('button').onclick = () => { prepayments.splice(index, 1); renderPrepayments(); refreshMessage(); };
      root.appendChild(row);
    });
    if (!prepayments.length) root.innerHTML = '<div class="summary">Предоплат нет.</div>';
  }

  function addPrepayment() {
    prepayments.push({ date: $('cashReportDate').value || '', amount: 0, method: 'online' });
    renderPrepayments();
    refreshMessage();
  }

  function numeric(id) { return Number($(id).value) || 0; }
  function money(value, blankWhenZero) {
    const number = Number(value) || 0;
    if (blankWhenZero && !number) return '';
    return number.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function plainMoney(value) {
    const number = Number(value) || 0;
    return number.toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(number) ? 0 : 2, maximumFractionDigits: 2 });
  }
  function shortDate(value) {
    const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return match ? match[1] + '.' + match[2] + '.' + match[3].slice(-2) : String(value || '');
  }
  function paymentPhrase(method) {
    return { cash: 'наличными в ресторане', online: 'оплата по ссылке', card: 'картой в ресторане', account: 'расчётный счёт' }[method] || 'оплата';
  }
  function paymentLine(label, value) {
    const formatted = money(value, true);
    return '🟢 ' + label + ':' + (formatted ? ' ' + formatted : '');
  }

  function updateComparison() {
    const terminalTotal = terminalSlips.reduce((sum, slip) => sum + (Number(slip.amount) || 0), 0);
    const iiko = numeric('cashReportBankCards');
    const difference = terminalTotal - iiko;
    const element = $('cashReportComparison');
    if (!terminalSlips.length) {
      element.className = 'comparison warn';
      element.textContent = '⚠️ Терминальные слипы не распознаны. Добавьте суммы вручную.';
      return { terminalTotal, difference: null, text: 'Слипы не указаны' };
    }
    if (Math.abs(difference) < .01) {
      element.className = 'comparison ok';
      element.textContent = '✅ Безнал совпадает. Терминалы: ' + money(terminalTotal) + ' · iiko: ' + money(iiko);
      return { terminalTotal, difference: 0, text: 'Совпадает' };
    }
    const direction = difference > 0 ? 'Плюс' : 'Минус';
    element.className = 'comparison err';
    element.textContent = '⚠️ ' + direction + ' по терминалам: ' + money(Math.abs(difference)) + ' · Терминалы: ' + money(terminalTotal) + ' · iiko: ' + money(iiko);
    return { terminalTotal, difference, text: direction + ' ' + money(Math.abs(difference)) };
  }

  function refreshMessage() {
    const date = $('cashReportDate').value.trim();
    const collection = numeric('cashReportCollection');
    const collectionActual = numeric('cashReportCollectionActual');
    const lines = [
      'Tatooine',
      '',
      '🏜 РЕСТОРАН TATOOINE',
      '👨‍💻 ОТЧЕТ КАССОВОЙ СМЕНЫ',
      'ДАТА ' + date,
      '',
      'Общая выручка: ' + money(numeric('cashReportTotalRevenue')),
      '',
      paymentLine('Безнал', numeric('cashReportBankCards')),
      paymentLine('Безнал 2', numeric('cashReportBankCards2')),
      paymentLine('Нал', numeric('cashReportCashNonFiscal')),
      paymentLine('Нал Фискал', numeric('cashReportCashFiscal')),
      paymentLine('Нал 2', numeric('cashReportCash2')),
      paymentLine('Tapper', numeric('cashReportTapper')),
      paymentLine('Расчётный счёт', numeric('cashReportSettlement')),
      paymentLine('Расчётный счёт 2', numeric('cashReportSettlement2')),
      paymentLine('Онлайн-Касса 2', numeric('cashReportOnlineCashbox2')),
      '',
      'Расход: ' + plainMoney(numeric('cashReportExpense'))
    ];
    const expenseComment = $('cashReportExpenseComment').value.trim();
    if (expenseComment) lines.push('Комментарий к расходу: ' + expenseComment);
    lines.push(
      '',
      'Инкассация:' + (collection ? ' ' + plainMoney(collection) : '') + (collectionActual ? ' (' + plainMoney(collectionActual) + ')' : ''),
      'На утро в кассе [' + plainMoney(numeric('cashReportMorningCash')) + ']',
      'Неизменный размен [' + plainMoney(numeric('cashReportChangeFund')) + ']'
    );
    prepayments.filter(item => item.date && Number(item.amount) > 0).forEach(item => {
      lines.push('', '🟢 Предоплата: ' + shortDate(item.date), plainMoney(item.amount) + ' ' + paymentPhrase(item.method));
    });
    $('cashReportMessage').value = lines.join('\n');
    updateComparison();
  }

  function confirmMismatch(message) {
    return new Promise(resolve => {
      const overlay = $('cashConfirm');
      $('cashConfirmMessage').textContent = message;
      overlay.hidden = false;
      const finish = value => {
        overlay.hidden = true;
        $('cashConfirmCancel').onclick = null;
        $('cashConfirmOk').onclick = null;
        overlay.onclick = null;
        resolve(Boolean(value));
      };
      $('cashConfirmCancel').onclick = () => finish(false);
      $('cashConfirmOk').onclick = () => finish(true);
      overlay.onclick = event => { if (event.target === overlay) finish(false); };
    });
  }

  function resetSendButton() {
    const button = $('cashReportSend');
    button.disabled = false;
    button.textContent = '📨 Отправить отчёт в чат';
  }

  async function sendReport() {
    if (!jobId) { setStatus('warn', 'Сначала распознайте кассовый отчёт.'); return; }
    const message = $('cashReportMessage').value.trim();
    if (!message) { setStatus('warn', 'Сообщение пустое.'); return; }
    const comparison = updateComparison();
    if (comparison.difference !== null && Math.abs(comparison.difference) >= .01) {
      const approved = await confirmMismatch('Есть расхождение по терминалам: ' + comparison.text + '. Всё равно отправить отчёт?');
      if (!approved) return;
    }
    const button = $('cashReportSend');
    button.disabled = true;
    button.textContent = 'Отправляю…';
    try {
      setStatus('', 'Отправляю кассовый отчёт в Telegram…', .25);
      post({ action: 'cashReportSend', jobId, messageText: message }).catch(() => {});
      const status = await pollJob(jobId, ['CASH_SENT', 'SEND_ERROR'], 120000);
      if (status.status === 'SEND_ERROR') throw new Error(status.error || 'Ошибка Telegram.');
      setStatus('ok', 'Кассовый отчёт отправлен. Текст можно исправить и отправить повторно.', 1);
      button.disabled = false;
      button.textContent = '📨 Отправить отчёт ещё раз';
      haptic('success');
    } catch (error) {
      button.disabled = false;
      button.textContent = '📨 Повторить отправку';
      setStatus('err', String(error && error.message ? error.message : error), 1);
    }
  }

  function bindInputs() {
    [
      'cashReportDate', 'cashReportTotalRevenue', 'cashReportBankCards', 'cashReportBankCards2',
      'cashReportCashNonFiscal', 'cashReportCashFiscal', 'cashReportCash2', 'cashReportTapper',
      'cashReportSettlement', 'cashReportSettlement2', 'cashReportOnlineCashbox2', 'cashReportExpense',
      'cashReportExpenseComment', 'cashReportCollection', 'cashReportCollectionActual',
      'cashReportMorningCash', 'cashReportChangeFund'
    ].forEach(id => {
      $(id).addEventListener('input', refreshMessage);
      $(id).addEventListener('change', refreshMessage);
    });
  }

  async function checkBackend() {
    if (!apiConfigured()) { setStatus('err', 'Адрес существующего обработчика не настроен.'); return; }
    try {
      const ping = await jsonp({ action: 'ping' });
      if (!ping || !ping.ok) throw new Error(ping && ping.error ? ping.error : 'Обработчик не ответил.');
      if (!TG || !TG.initData) {
        setStatus('warn', 'Обработчик подключён (' + String(ping.version || '') + '). Для распознавания откройте приложение через Telegram.');
      } else {
        setStatus('ok', 'Обработчик подключён. Добавьте фотографии отчёта iiko и терминальных слипов.');
      }
    } catch (error) {
      setStatus('err', String(error && error.message ? error.message : error));
    }
  }

  function init() {
    $('appVersion').textContent = String(CONFIG.version || 'v1.0.0');
    $('cashReportChangeFund').value = String(Number(CONFIG.defaultChangeFund) || 0);
    if (TG) {
      try { TG.ready(); TG.expand(); } catch (_) {}
      try { TG.setHeaderColor('#0e1116'); TG.setBackgroundColor('#0e1116'); } catch (_) {}
      try { TG.disableVerticalSwipes(); } catch (_) {}
    }
    $('cashReportCamera').addEventListener('change', async event => { const files = event.target.files; event.target.value = ''; await appendFiles(files); });
    $('cashReportGallery').addEventListener('change', async event => { const files = event.target.files; event.target.value = ''; await appendFiles(files); });
    $('cashReportReset').addEventListener('click', () => { if (pages.length && !window.confirm('Удалить все фотографии кассового отчёта?')) return; resetAll(); });
    $('cashReportRecognize').addEventListener('click', recognize);
    $('cashReportAddSlip').addEventListener('click', addSlip);
    $('cashReportAddPrepayment').addEventListener('click', addPrepayment);
    $('cashReportSend').addEventListener('click', sendReport);
    bindInputs();
    renderPages();
    checkBackend();
  }

  window.TatooineCashTest = Object.freeze({ base64DecodedBytes, validateOcrImages, updateComparison });
  init();
})();
