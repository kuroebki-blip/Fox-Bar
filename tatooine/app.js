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
  let cameraStream = null;
  let currentUser = null;
  let myRide = null;
  let rideAddressTargetUserId = '';
  let rideAddressSelectedSuggestion = null;
  let rideAddressSuggestionTimer = null;
  let rideAddressSuggestionRequest = 0;
  let rideOrigin = null;
  let rideOriginSelectedSuggestion = null;
  let rideOriginSuggestionTimer = null;
  let rideOriginSuggestionRequest = 0;
  let todayRideEmployeeIds = new Set();
  let locallyRemovedRideEmployeeIds = new Set();
  let rideRouteCalculation = null;
  let rideOptimization = null;
  let rideRouteDetails = null;

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => {
    setTimeout(resolve, ms);
  });

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
      venue: String(CONFIG.venue || 'tatooine'),
      telegramUserId: user && user.id ? String(user.id) : '',
      telegramUserName: user ? ([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id || '')) : '',
      telegramChatId: chat && chat.id ? String(chat.id) : '',
      telegramInitData: TG ? String(TG.initData || '') : ''
    };
  }

  function apiConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(API_URL);
  }

  function canPermissions(user, permission) {
    return Boolean(user && Array.isArray(user.permissions) && user.permissions.includes(String(permission || '')));
  }

  function can(permission) {
    return canPermissions(currentUser, permission);
  }

  function showScreen(name) {
    const screens = {
      hub: $('tatooineHub'),
      cash: $('cashReportScreen'),
      taxi: $('taxiScreen'),
      roles: $('roleManagementScreen'),
      settings: $('rideOriginSettingsScreen')
    };
    Object.keys(screens).forEach(key => {
      if (screens[key]) screens[key].hidden = key !== name;
    });
    window.scrollTo(0, 0);
  }

  async function openRoleManagement() {
    if (!can('roles.manage')) return;
    showScreen('roles');
    showRoleStatus('Загружаю сотрудников…');
    try {
      await loadRoleDirectory();
      showRoleStatus('');
    } catch (_) {
      showRoleStatus('Не удалось загрузить список сотрудников.');
    }
  }

  function renderRideOrigin() {
    const card = $('rideOriginSettingsCard');
    const status = $('rideOriginStatus');
    const edit = $('rideOriginEdit');
    if (!card || !status || !edit) return;
    card.hidden = !can('rides.manage_origin');
    if (card.hidden) return;
    const address = rideOrigin ? String(rideOrigin.addressText || '') : '';
    status.replaceChildren();
    if (!address) {
      status.textContent = 'Адрес не указан';
      edit.textContent = 'Указать адрес';
      return;
    }
    const name = document.createElement('b');
    name.textContent = String(rideOrigin.name || 'Tatooine');
    const text = document.createElement('div');
    text.textContent = address;
    status.append(name, text);
    edit.textContent = 'Изменить адрес';
  }

  async function loadRideOrigin() {
    if (!can('rides.manage_origin')) return null;
    setRideStatus('rideOriginStatus', 'Загружаю адрес…');
    try {
      const data = await jsonp(Object.assign({ action: 'tatooineRideOrigin' }, authParams()));
      if (!data || !data.ok || !data.location) throw new Error(data && data.error ? data.error : 'Не удалось загрузить адрес.');
      rideOrigin = data.location;
      renderRideOrigin();
      return rideOrigin;
    } catch (error) {
      rideOrigin = null;
      setRideStatus('rideOriginStatus', errorMessage(error, 'Не удалось загрузить адрес.'));
      return null;
    }
  }

  async function openRideOriginSettings() {
    if (!can('rides.manage_origin')) return;
    showScreen('settings');
    renderRideOrigin();
    await loadRideOrigin();
  }

  function errorMessage(error, fallback) {
    return String(error && error.message ? error.message : fallback || 'Не удалось выполнить действие.');
  }

  function setRideStatus(id, text) {
    const el = $(id);
    if (el) el.textContent = text || '';
  }

  function renderMyRide() {
    const status = $('myRideStatus');
    const confirm = $('rideConfirm');
    const cancel = $('rideCancel');
    if (!status || !confirm || !cancel) return;
    const address = myRide && myRide.address ? String(myRide.address.text || '') : '';
    if (!address) {
      status.textContent = 'Адрес развоза не указан. Обратитесь к менеджеру.';
      confirm.hidden = true;
      cancel.hidden = true;
      return;
    }
    status.replaceChildren();
    const title = document.createElement('b');
    title.textContent = myRide && myRide.needsRide ? '✓ Вы едете домой' : 'Ваш адрес:';
    const text = document.createElement('div');
    text.textContent = address;
    status.append(title, text);
    confirm.hidden = Boolean(myRide && myRide.needsRide);
    cancel.hidden = !myRide || !myRide.needsRide;
  }

  async function getMyRideData(timeoutMs) {
    const data = await jsonp(Object.assign({ action: 'tatooineMyRide' }, authParams()), timeoutMs);
    if (!data || !data.ok || !data.ride) throw new Error(data && data.error ? data.error : 'Не удалось загрузить развоз.');
    return data.ride;
  }

  async function loadMyRide() {
    setRideStatus('myRideStatus', 'Загружаю данные…');
    try {
      myRide = await getMyRideData();
      renderMyRide();
    } catch (error) {
      myRide = null;
      setRideStatus('myRideStatus', errorMessage(error, 'Не удалось загрузить развоз.'));
      $('rideConfirm').hidden = true;
      $('rideCancel').hidden = true;
    }
  }

  async function writeRide(params) {
    const data = await jsonp(Object.assign({}, params, authParams()));
    if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'Не удалось сохранить заявку.');
    return data.request || null;
  }

  async function setMyRideNeeded(needsRide) {
    const confirm = $('rideConfirm');
    const cancel = $('rideCancel');
    let writeCompleted = false;
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      setRideStatus('myRideStatus', 'Сохраняю…');
      const currentEmployeeId = currentUser ? String(currentUser.id || '') : '';
      if (can('rides.view_all') && currentEmployeeId) {
        if (needsRide) locallyRemovedRideEmployeeIds.delete(currentEmployeeId);
        else locallyRemovedRideEmployeeIds.add(currentEmployeeId);
      }
      await writeRide({ action: 'tatooineSetMyRide', needsRide: needsRide ? 'true' : 'false' });
      writeCompleted = true;
      await loadMyRide();
      if (can('rides.view_all')) await loadRideManager();
      if (can('rides.optimize')) {
        await loadRideRouteCalculation();
        await loadRideOptimization().catch(() => {});
      }
      haptic('success');
    } catch (error) {
      // The backend may have completed a write while the JSONP response timed
      // out. Do not leave the previous confirmed state visible as if it were
      // still current; it will be refreshed on the next successful read.
      myRide = null;
      if (!needsRide && !writeCompleted && currentUser) locallyRemovedRideEmployeeIds.delete(String(currentUser.id || ''));
      confirm.hidden = true;
      cancel.hidden = true;
      setRideStatus('myRideStatus', errorMessage(error, 'Не удалось сохранить заявку.'));
    } finally {
      confirm.disabled = false;
      cancel.disabled = false;
    }
  }

  function ridePersonElement(item, buttonLabel, buttonClass, onClick) {
    const row = document.createElement('div');
    row.className = 'ride-person';
    row.dataset.rideEmployeeId = String(item.employeeId || '');
    const details = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = item.name || 'Сотрудник';
    const address = document.createElement('small');
    address.textContent = item.address && item.address.text ? item.address.text : 'Адрес не указан';
    details.append(name, address);
    row.appendChild(details);
    if (buttonLabel) {
      appendRidePersonAction(row, buttonLabel, buttonClass, onClick);
    }
    return row;
  }

  function ridePersonRows(employeeId) {
    return Array.from(document.querySelectorAll('.ride-person[data-ride-employee-id]')).filter(row => row.dataset.rideEmployeeId === String(employeeId));
  }

  function setRidePersonRemoving(employeeId, removing) {
    ridePersonRows(employeeId).forEach(row => {
      row.classList.toggle('ride-person-removing', Boolean(removing));
      const button = row.querySelector('.ride-remove');
      if (!button) return;
      if (removing) {
        button.dataset.defaultLabel = button.dataset.defaultLabel || button.textContent;
        button.textContent = 'Убираем…';
        button.disabled = true;
      } else {
        button.textContent = button.dataset.defaultLabel || 'Убрать из развоза';
        button.disabled = false;
      }
    });
  }

  function setRidePersonRemoved(employeeId) {
    ridePersonRows(employeeId).forEach(row => row.classList.add('ride-person-removed'));
  }

  function appendRidePersonAction(row, label, className, onClick) {
    let controls = row.querySelector('.ride-person-actions');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'ride-person-actions';
      row.appendChild(controls);
    }
    if (label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className || '';
      button.textContent = label;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try { await onClick(); }
        finally { button.disabled = false; }
      });
      controls.appendChild(button);
    }
  }

  function renderRideManager(items) {
    const card = $('rideManagerCard');
    const list = $('rideTodayList');
    if (!card || !list) return;
    card.hidden = !can('rides.view_all');
    if (card.hidden) return;
    const values = currentRideManagerItems(items);
    todayRideEmployeeIds = new Set(values.map(item => String(item.employeeId || '')));
    setRideStatus('rideManagerStatus', 'Едут домой: ' + values.length);
    list.replaceChildren();
    values.forEach(item => list.appendChild(ridePersonElement(item, can('rides.override') ? 'Убрать из развоза' : '', 'ride-remove', () => setEmployeeRideNeeded(item.employeeId, false))));
    if (!values.length) list.textContent = 'Сегодня активных заявок нет.';
  }

  function currentRideManagerItems(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter(item => {
      const employeeId = String(item && item.employeeId || '');
      if (!employeeId || seen.has(employeeId) || locallyRemovedRideEmployeeIds.has(employeeId)) return false;
      seen.add(employeeId);
      return true;
    });
  }

  async function getRideManagerItems(timeoutMs) {
    const data = await jsonp(Object.assign({ action: 'tatooineRideToday' }, authParams()), timeoutMs);
    if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'Не удалось загрузить список.');
    return Array.isArray(data.items) ? data.items : [];
  }

  async function loadRideManager() {
    if (!can('rides.view_all')) return;
    setRideStatus('rideManagerStatus', 'Загружаю список…');
    try {
      const items = await getRideManagerItems();
      renderRideManager(items);
      return items;
    } catch (error) {
      // A failed refresh must never keep an old active list on screen. That
      // would make a completed cancellation look as if it had not worked.
      todayRideEmployeeIds = new Set();
      const list = $('rideTodayList');
      if (list) list.replaceChildren();
      setRideStatus('rideManagerStatus', errorMessage(error, 'Не удалось загрузить список.'));
      return null;
    }
  }

  function renderRideRouteCalculation() {
    const controls = $('rideRouteControls');
    const button = $('rideRouteCalculate');
    const details = $('rideRouteDetails');
    if (!controls || !button || !details) return;
    controls.hidden = !can('rides.optimize');
    if (controls.hidden) return;
    button.textContent = rideRouteCalculation && rideRouteCalculation.status === 'READY' ? 'Пересчитать маршруты' : 'Рассчитать маршруты';
    details.hidden = !(rideRouteCalculation && rideRouteCalculation.status === 'READY');
    if (!rideRouteCalculation) { setRideStatus('rideRouteStatus', ''); renderRideOptimization(); return; }
    if (rideRouteCalculation.status === 'PROCESSING') { setRideStatus('rideRouteStatus', 'Рассчитываем маршруты…'); return; }
    if (rideRouteCalculation.status === 'READY') {
      setRideStatus('rideRouteStatus', rideRouteCalculation.isCurrent === false ? 'Состав развоза изменился. Пересчитайте маршруты.' : 'Маршрутные данные готовы\nТочка старта: ' + (rideRouteCalculation.originName || 'Tatooine') + '\nУчастников: ' + rideRouteCalculation.employeeCount + '\nРассчитано направлений: ' + rideRouteCalculation.edgeCount);
      renderRideOptimization(); return;
    }
    if (rideRouteCalculation.status === 'INPUT_ERROR') { setRideStatus('rideRouteStatus', 'Не удалось подготовить адреса. Проверьте адреса сотрудников и точку старта.'); return; }
    setRideStatus('rideRouteStatus', rideRouteCalculation.error || 'Не удалось рассчитать маршруты.'); renderRideOptimization();
  }

  function renderRideOptimization() {
    const button = $('rideOptimize'); const list = $('rideOptimizationList'); if (!button || !list) return;
    button.hidden = !(rideRouteCalculation && rideRouteCalculation.status === 'READY' && rideRouteCalculation.isCurrent !== false && can('rides.optimize'));
    list.replaceChildren();
    if (!rideOptimization || rideOptimization.state !== 'ready') return;
    const result = rideOptimization.result; const summary = document.createElement('div'); summary.className = 'ride-status'; summary.textContent = result.participantCount + ' сотрудников · ' + result.carCount + ' машин · Средняя загрузка: ' + result.summary.averagePassengersPerCar.toFixed(1).replace('.', ',') + '\nПредотвращено отдельных поездок: ' + result.summary.avoidedIndividualCars; list.appendChild(summary);
    (result.cars || []).forEach(car => { const row=document.createElement('div'); row.className='ride-person'; const text=document.createElement('div'); const title=document.createElement('b'); title.textContent='Машина '+car.carId.replace('ride_car_','')+' · '+car.passengerCount+' сотрудника'; const detail=document.createElement('small'); detail.textContent=car.passengers.map(p=>p.dropoffPosition+'. '+p.employeeName+' — '+(p.extraDurationSeconds ? '+'+Math.round(p.extraDurationSeconds/60)+' мин' : 'без крюка')).join('\n')+'\n'+Math.round(car.routeDurationSeconds/60)+' мин · '+(car.routeDistanceMeters/1000).toFixed(1).replace('.',',')+' км\nМаксимальный крюк: '+(car.maxExtraDurationSeconds ? '+'+Math.round(car.maxExtraDurationSeconds/60)+' мин' : 'без крюка'); const actions=document.createElement('div'); actions.className='ride-person-actions'; const openMap=document.createElement('button'); openMap.className='ride-add'; openMap.type='button'; openMap.textContent='Открыть в Яндекс Картах'; openMap.addEventListener('click', () => openRideCarInYandexMaps(car, openMap)); const copyRoute=document.createElement('button'); copyRoute.type='button'; copyRoute.textContent='Скопировать маршрут'; copyRoute.addEventListener('click', () => copyRideCarRoute(car, copyRoute)); actions.append(openMap,copyRoute); text.append(title,detail); row.append(text,actions); list.appendChild(row); });
    (result.unresolvedParticipants || []).forEach(p=>{const row=document.createElement('div');row.className='ride-person';row.textContent='Не удалось автоматически распределить: '+p.employeeName+' — '+p.reason;list.appendChild(row);});
  }
  async function loadRideOptimization() { if (!can('rides.optimize')) return; const data=await jsonp(Object.assign({action:'tatooineRideOptimization'},authParams())); if(!data||!data.ok)throw new Error(data&&data.error||'Не удалось загрузить машины.'); rideOptimization=data.optimization; if (rideOptimization && rideOptimization.state === 'ready') { try { await loadRideRouteDetails(); } catch (_) {} } renderRideOptimization(); }
  async function optimizeRide() { const button=$('rideOptimize'); button.disabled=true; setRideStatus('rideRouteStatus','Формируем машины…'); try { await post({action:'tatooineOptimizeRide'}); await sleep(500); await loadRideOptimization(); haptic('success'); } catch(error) { setRideStatus('rideRouteStatus',errorMessage(error,'Не удалось сформировать машины.')); } finally { button.disabled=false; } }

  function buildYandexMapsExternalRouteUrl(origin, dropoffs) {
    const points = [origin].concat(dropoffs || []);
    if (points.length < 2 || points.some(point => !point || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude)))) throw new Error('Не удалось подготовить точки маршрута.');
    const routeText = points.map(point => Number(point.latitude) + ',' + Number(point.longitude)).join('~');
    return 'https://yandex.ru/maps/?mode=routes&rtext=' + encodeURIComponent(routeText) + '&rtt=auto';
  }

  async function loadRideRouteDetails() {
    if (!can('rides.optimize') || !rideRouteCalculation || rideRouteCalculation.status !== 'READY') throw new Error('Сначала подготовьте маршруты.');
    if (rideRouteDetails && rideRouteDetails.calculation && rideRouteDetails.calculation.id === rideRouteCalculation.id) return rideRouteDetails;
    const data = await jsonp(Object.assign({ action: 'tatooineRideRouteDetails', calculationId: rideRouteCalculation.id }, authParams()));
    if (!data || !data.ok || !data.details) throw new Error(data && data.error ? data.error : 'Не удалось подготовить маршрут.');
    rideRouteDetails = data.details;
    return rideRouteDetails;
  }

  function loadRideCarRouteData(car) {
    const details = rideRouteDetails;
    if (!details) throw new Error('Маршрут ещё загружается. Повторите попытку через секунду.');
    const calculation = details.calculation || {};
    const byPointId = {};
    (details.participants || []).forEach(point => { byPointId[point.pointId] = point; });
    const dropoffs = (car.dropoffOrder || []).map(pointId => byPointId[pointId]).filter(Boolean);
    if (dropoffs.length !== (car.dropoffOrder || []).length) throw new Error('Не удалось подготовить все точки маршрута.');
    return { origin: { name: calculation.originName || 'Tatooine', addressText: calculation.originAddress || '', latitude: calculation.originLatitude, longitude: calculation.originLongitude }, dropoffs };
  }

  async function copyRideCarRoute(car, button) {
    button.disabled = true;
    try {
      const route = await loadRideCarRouteData(car);
      const text = [route.origin.name].concat(route.dropoffs.map(point => point.address || point.addressText)).join('\n→ ');
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement('textarea'); textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); const copied = document.execCommand('copy'); textarea.remove(); if (!copied) throw new Error('Не удалось скопировать маршрут.');
      }
      setRideStatus('rideRouteStatus', 'Маршрут скопирован.');
      haptic('success');
    } catch (error) { setRideStatus('rideRouteStatus', errorMessage(error, 'Не удалось скопировать маршрут.')); }
    finally { button.disabled = false; }
  }

  async function openRideCarInYandexMaps(car, button) {
    button.disabled = true;
    try {
      const route = loadRideCarRouteData(car);
      if (!TG || typeof TG.openLink !== 'function') throw new Error('Откройте маршрут через Telegram на iPhone.');
      TG.openLink(buildYandexMapsExternalRouteUrl(route.origin, route.dropoffs));
      setRideStatus('rideRouteStatus', 'Открываю Яндекс Карты…');
    } catch (error) { setRideStatus('rideRouteStatus', errorMessage(error, 'Не удалось открыть маршрут.')); button.disabled = false; }
    finally { button.disabled = false; }
  }

  async function loadRideRouteCalculation(calculationId) {
    if (!can('rides.optimize')) return null;
    const data = await jsonp(Object.assign({ action: 'tatooineRideRouteCalculation', calculationId: calculationId || '' }, authParams()));
    if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'Не удалось загрузить расчёт.');
    rideRouteCalculation = data.calculation || null;
    if (!rideRouteDetails || !rideRouteCalculation || !rideRouteDetails.calculation || rideRouteDetails.calculation.id !== rideRouteCalculation.id) rideRouteDetails = null;
    renderRideRouteCalculation();
    return rideRouteCalculation;
  }

  async function calculateRideRoutes() {
    if (!can('rides.optimize')) return;
    const button = $('rideRouteCalculate');
    const calculationId = 'ride_route_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    button.disabled = true;
    setRideStatus('rideRouteStatus', 'Подготавливаем адреса…');
    try {
      await post({ action: 'tatooineCalculateRideRoutes', calculationId });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(700);
        const calculation = await loadRideRouteCalculation(calculationId);
        if (calculation && calculation.status !== 'PROCESSING') break;
      }
      if (!rideRouteCalculation || rideRouteCalculation.status === 'PROCESSING') throw new Error('Расчёт ещё выполняется. Обновите раздел через минуту.');
      if (rideRouteCalculation.status !== 'READY') return;
      haptic('success');
    } catch (error) {
      setRideStatus('rideRouteStatus', errorMessage(error, 'Не удалось рассчитать маршруты.'));
    } finally { button.disabled = false; }
  }

  async function openRideRouteDetails() {
    if (!can('rides.optimize') || !rideRouteCalculation || rideRouteCalculation.status !== 'READY') return;
    const list = $('rideRouteDetailsList'); list.textContent = 'Загружаю данные…'; $('rideRouteDetailsDialog').hidden = false;
    try {
      const data = await jsonp(Object.assign({ action: 'tatooineRideRouteDetails', calculationId: rideRouteCalculation.id }, authParams()));
      if (!data || !data.ok || !data.details) throw new Error(data && data.error ? data.error : 'Не удалось загрузить детали.');
      const names = { origin: data.details.calculation.originName || 'Точка старта' }; (data.details.participants || []).forEach(item => { names[item.pointId] = item.name; });
      list.replaceChildren();
      (data.details.edges || []).forEach(edge => { const row = document.createElement('div'); row.className = 'ride-person'; const text = document.createElement('div'); const title = document.createElement('b'); title.textContent = (names[edge.fromId] || edge.fromId) + ' → ' + (names[edge.toId] || edge.toId); const value = document.createElement('small'); value.textContent = edge.status === 'ok' ? (Math.round(edge.durationSeconds / 60) + ' мин · ' + (edge.distanceMeters / 1000).toFixed(1).replace('.', ',') + ' км') : 'Маршрут недоступен'; text.append(title, value); row.appendChild(text); list.appendChild(row); });
    } catch (error) { list.textContent = errorMessage(error, 'Не удалось загрузить детали.'); }
  }

  async function setEmployeeRideNeeded(employeeId, needsRide) {
    let writeCompleted = false;
    try {
      setRideStatus('rideManagerStatus', 'Сохраняю…');
      if (needsRide) locallyRemovedRideEmployeeIds.delete(String(employeeId));
      else {
        locallyRemovedRideEmployeeIds.add(String(employeeId));
        setRidePersonRemoving(employeeId, true);
      }
      await writeRide({ action: 'tatooineSetEmployeeRide', targetUserId: employeeId, needsRide: needsRide ? 'true' : 'false' });
      writeCompleted = true;
      if (!needsRide) {
        setRidePersonRemoved(employeeId);
        await sleep(220);
      }
      await loadRideManager();
      await loadRideAddresses();
      if (can('rides.optimize')) {
        await loadRideRouteCalculation();
        await loadRideOptimization().catch(() => {});
      }
      setRideStatus('rideManagerStatus', needsRide ? 'Сотрудник добавлен в развоз.' : 'Сотрудник убран из развоза.');
    } catch (error) {
      if (!needsRide && !writeCompleted) {
        locallyRemovedRideEmployeeIds.delete(String(employeeId));
        setRidePersonRemoving(employeeId, false);
      }
      setRideStatus('rideManagerStatus', errorMessage(error, 'Не удалось обновить развоз.'));
    }
  }

  function renderRideAddresses(items) {
    const card = $('rideAddressManagementCard');
    const list = $('rideEmployeeAddressList');
    if (!card || !list) return;
    card.hidden = !can('rides.manage_addresses');
    if (card.hidden) return;
    const values = Array.isArray(items) ? items : [];
    list.replaceChildren();
    values.forEach(item => {
      const label = item.address && item.address.text ? 'Изменить' : 'Добавить';
      const row = ridePersonElement(item, label, 'ride-add', () => openRideAddressDialog(item));
      if (item.address && item.address.text && !todayRideEmployeeIds.has(String(item.id || '')) && can('rides.override')) {
        appendRidePersonAction(row, 'Добавить в развоз', 'ride-add', () => setEmployeeRideNeeded(item.id, true));
      }
      list.appendChild(row);
    });
    if (!values.length) list.textContent = 'Сотрудники ещё не открывали приложение.';
  }

  async function loadRideAddresses() {
    if (!can('rides.manage_addresses')) return;
    setRideStatus('rideAddressStatus', 'Загружаю сотрудников…');
    try {
      const data = await jsonp(Object.assign({ action: 'tatooineRideEmployees' }, authParams()));
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'Не удалось загрузить сотрудников.');
      setRideStatus('rideAddressStatus', '');
      renderRideAddresses(data.items);
      return Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      setRideStatus('rideAddressStatus', errorMessage(error, 'Не удалось загрузить сотрудников.'));
      return null;
    }
  }

  function openRideAddressDialog(item) {
    rideAddressTargetUserId = String(item && item.id || '');
    const address = item && item.address ? item.address : null;
    $('rideAddressInput').value = address ? String(address.text || '') : '';
    rideAddressSelectedSuggestion = address && address.text && address.latitude !== '' && address.longitude !== '' ? {
      text: String(address.text), latitude: Number(address.latitude), longitude: Number(address.longitude)
    } : null;
    clearRideAddressSuggestions();
    $('rideAddressDialogClear').hidden = !($('rideAddressInput').value);
    $('rideAddressDialog').hidden = false;
    $('rideAddressInput').focus();
  }

  function closeRideAddressDialog() {
    if (rideAddressSuggestionTimer) clearTimeout(rideAddressSuggestionTimer);
    rideAddressSuggestionTimer = null;
    rideAddressSuggestionRequest += 1;
    rideAddressTargetUserId = '';
    rideAddressSelectedSuggestion = null;
    clearRideAddressSuggestions();
    $('rideAddressDialog').hidden = true;
  }

  function clearRideAddressSuggestions() {
    const list = $('rideAddressSuggestions');
    if (list) list.replaceChildren();
  }

  function renderRideAddressSuggestions(items) {
    const list = $('rideAddressSuggestions');
    if (!list) return;
    list.replaceChildren();
    (Array.isArray(items) ? items : []).forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ride-address-suggestion';
      button.textContent = String(item.text || '');
      button.addEventListener('click', () => {
        $('rideAddressInput').value = String(item.text || '');
        rideAddressSelectedSuggestion = item;
        clearRideAddressSuggestions();
      });
      list.appendChild(button);
    });
  }

  function queueRideAddressSuggestions() {
    rideAddressSelectedSuggestion = null;
    if (rideAddressSuggestionTimer) clearTimeout(rideAddressSuggestionTimer);
    clearRideAddressSuggestions();
    const query = $('rideAddressInput').value.trim();
    if (query.length < 3 || !rideAddressTargetUserId) return;
    const requestId = ++rideAddressSuggestionRequest;
    rideAddressSuggestionTimer = setTimeout(async () => {
      try {
        const data = await jsonp(Object.assign({ action: 'tatooineRideAddressSuggestions', query: query }, authParams()));
        if (requestId !== rideAddressSuggestionRequest || !data || !data.ok) return;
        renderRideAddressSuggestions(data.items);
      } catch (_) {
        if (requestId === rideAddressSuggestionRequest) clearRideAddressSuggestions();
      }
    }, 300);
  }

  async function saveRideAddress(clearAddress) {
    if (!rideAddressTargetUserId) return;
    const save = $('rideAddressDialogSave');
    const clear = $('rideAddressDialogClear');
    save.disabled = true;
    clear.disabled = true;
    try {
      const selected = rideAddressSelectedSuggestion && rideAddressSelectedSuggestion.text === $('rideAddressInput').value ? rideAddressSelectedSuggestion : null;
      await post({ action: 'tatooineSetEmployeeRideAddress', targetUserId: rideAddressTargetUserId, addressText: $('rideAddressInput').value, homeLatitude: selected ? selected.latitude : '', homeLongitude: selected ? selected.longitude : '', clearAddress: clearAddress ? 'true' : 'false' });
      await sleep(300);
      const employees = await loadRideAddresses();
      const updated = employees && employees.find(item => String(item.id || '') === rideAddressTargetUserId);
      const expectedAddress = clearAddress ? '' : $('rideAddressInput').value.trim().replace(/\s+/g, ' ');
      if (!updated || String(updated.address && updated.address.text || '') !== expectedAddress) {
        throw new Error('Адрес не сохранился. Повторите попытку.');
      }
      await loadRideManager();
      if (currentUser && String(currentUser.id) === rideAddressTargetUserId) await loadMyRide();
      closeRideAddressDialog();
    } catch (error) {
      setRideStatus('rideAddressStatus', errorMessage(error, 'Не удалось сохранить адрес.'));
    } finally {
      save.disabled = false;
      clear.disabled = false;
    }
  }

  function clearRideOriginSuggestions() {
    const list = $('rideOriginSuggestions');
    if (list) list.replaceChildren();
  }

  function renderRideOriginSuggestions(items) {
    const list = $('rideOriginSuggestions');
    if (!list) return;
    list.replaceChildren();
    (Array.isArray(items) ? items : []).forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ride-address-suggestion';
      button.textContent = String(item.text || '');
      button.addEventListener('click', () => {
        $('rideOriginInput').value = String(item.text || '');
        rideOriginSelectedSuggestion = item;
        clearRideOriginSuggestions();
      });
      list.appendChild(button);
    });
  }

  function openRideOriginDialog() {
    if (!can('rides.manage_origin')) return;
    const address = rideOrigin ? String(rideOrigin.addressText || '') : '';
    $('rideOriginInput').value = address;
    rideOriginSelectedSuggestion = rideOrigin && address && rideOrigin.latitude !== '' && rideOrigin.longitude !== '' ? {
      text: address, latitude: Number(rideOrigin.latitude), longitude: Number(rideOrigin.longitude)
    } : null;
    clearRideOriginSuggestions();
    $('rideOriginDialog').hidden = false;
    $('rideOriginInput').focus();
  }

  function closeRideOriginDialog() {
    if (rideOriginSuggestionTimer) clearTimeout(rideOriginSuggestionTimer);
    rideOriginSuggestionTimer = null;
    rideOriginSuggestionRequest += 1;
    rideOriginSelectedSuggestion = null;
    clearRideOriginSuggestions();
    $('rideOriginDialog').hidden = true;
  }

  function queueRideOriginSuggestions() {
    rideOriginSelectedSuggestion = null;
    if (rideOriginSuggestionTimer) clearTimeout(rideOriginSuggestionTimer);
    clearRideOriginSuggestions();
    const query = $('rideOriginInput').value.trim();
    if (query.length < 3 || !can('rides.manage_origin')) return;
    const requestId = ++rideOriginSuggestionRequest;
    rideOriginSuggestionTimer = setTimeout(async () => {
      try {
        const data = await jsonp(Object.assign({ action: 'tatooineRideOriginSuggestions', query: query }, authParams()));
        if (requestId !== rideOriginSuggestionRequest || !data || !data.ok) return;
        renderRideOriginSuggestions(data.items);
      } catch (_) {
        if (requestId === rideOriginSuggestionRequest) clearRideOriginSuggestions();
      }
    }, 300);
  }

  async function saveRideOrigin() {
    if (!can('rides.manage_origin')) return;
    const save = $('rideOriginDialogSave');
    save.disabled = true;
    try {
      const input = $('rideOriginInput').value;
      const selected = rideOriginSelectedSuggestion && rideOriginSelectedSuggestion.text === input ? rideOriginSelectedSuggestion : null;
      await post({ action: 'tatooineSetRideOrigin', addressText: input, latitude: selected ? selected.latitude : '', longitude: selected ? selected.longitude : '' });
      await sleep(300);
      const updated = await loadRideOrigin();
      const expectedAddress = input.trim().replace(/\s+/g, ' ');
      if (!updated || String(updated.addressText || '') !== expectedAddress) throw new Error('Адрес не сохранился. Повторите попытку.');
      closeRideOriginDialog();
      haptic('success');
    } catch (error) {
      setRideStatus('rideOriginStatus', errorMessage(error, 'Не удалось сохранить адрес.'));
    } finally {
      save.disabled = false;
    }
  }

  async function openTaxi() {
    showScreen('taxi');
    if (!currentUser) await loadCurrentUser();
    // Apps Script + Google Sheets is rate/queue sensitive in Telegram WebView.
    // Loading independent ride widgets in parallel caused requests to time out
    // and left stale cards visible. Keep this small, lazy screen load ordered.
    await loadMyRide();
    await loadRideManager();
    await loadRideAddresses();
    if (can('rides.optimize')) {
      await loadRideRouteCalculation();
      await loadRideOptimization().catch(() => {});
    }
  }

  function roleLabel(role) {
    return ({ employee: 'Employee', manager: 'Manager', admin: 'Admin', superadmin: 'Superadmin' })[String(role || '')] || String(role || 'Employee');
  }

  function showRoleStatus(text) {
    const el = $('roleStatus');
    if (el) el.textContent = text || '';
  }

  function renderRoleDirectory(data) {
    const card = $('roleManagement');
    const list = $('roleList');
    if (!card || !list) return;
    if (!can('roles.manage')) { card.hidden = true; return; }
    card.hidden = false;
    $('currentRole').textContent = roleLabel(currentUser.role);
    const roles = Array.isArray(data && data.roles) ? data.roles : [];
    const items = Array.isArray(data && data.items) ? data.items : [];
    list.innerHTML = items.map(user => {
      const options = roles.map(role => '<option value="' + escapeHtml(role) + '"' + (role === user.role ? ' selected' : '') + '>' + escapeHtml(roleLabel(role)) + '</option>').join('');
      return '<div class="role-user"><div><b>' + escapeHtml(user.name) + '</b><small>' + escapeHtml(roleLabel(user.role)) + '</small></div><select data-user-id="' + escapeHtml(user.id) + '">' + options + '</select></div>';
    }).join('') || '<div class="role-status">Сотрудники ещё не открывали приложение.</div>';
    list.querySelectorAll('select[data-user-id]').forEach(select => {
      select.addEventListener('change', async () => {
        select.disabled = true;
        showRoleStatus('Сохраняю роль…');
        try {
          await post({ action: 'tatooineSetRole', targetUserId: select.dataset.userId, role: select.value });
          await sleep(450);
          await loadCurrentUser();
          if (!can('roles.manage')) {
            showScreen('hub');
            return;
          }
          showRoleStatus('Роль обновлена.');
        } catch (_) {
          showRoleStatus('Не удалось обновить роль.');
          select.disabled = false;
        }
      });
    });
  }

  async function loadRoleDirectory() {
    if (!can('roles.manage')) return;
    const data = await jsonp(Object.assign({ action: 'tatooineEmployees' }, authParams()));
    if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'Нет доступа.');
    renderRoleDirectory(data);
  }

  async function loadCurrentUser() {
    if (!apiConfigured() || !TG || !TG.initData) return;
    try {
      const data = await jsonp(Object.assign({ action: 'currentUser' }, authParams()));
      if (!data || !data.ok || !data.user) throw new Error(data && data.error ? data.error : 'Нет доступа.');
      currentUser = data.user;
      const roleButton = $('openRoleManagement');
      if (roleButton) roleButton.hidden = !can('roles.manage');
      const settingsButton = $('openRideOriginSettings');
      if (settingsButton) settingsButton.hidden = !can('rides.manage_origin');
    } catch (_) {
      currentUser = null;
      const card = $('roleManagement');
      if (card) card.hidden = true;
      const roleButton = $('openRoleManagement');
      if (roleButton) roleButton.hidden = true;
      const settingsButton = $('openRideOriginSettings');
      if (settingsButton) settingsButton.hidden = true;
    }
  }

  function jsonp(params, timeoutMs = 35000) {
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

  function normalizedPaymentName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[‐‑‒–—-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^оплата\s+/, '')
      .replace(/\s+(?:продажа|предоплата)$/, '')
      .trim();
  }

  function exactPaymentRowAmount(rows, names) {
    const targets = (names || []).map(normalizedPaymentName);
    const found = (Array.isArray(rows) ? rows : []).find(row => targets.includes(normalizedPaymentName(row && (row.name || row.row_name))));
    return found ? Number(found.amount) || 0 : 0;
  }

  function hasReportValue(value) {
    return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function reportAmount(value, blankWhenMissing = false) {
    if (blankWhenMissing && !hasReportValue(value)) return '';
    const number = Number(value) || 0;
    return number.toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(number) ? 0 : 2, maximumFractionDigits: 2 }).replace(/\u00a0|\u202f/g, ' ');
  }

  function prepaymentAmount(value) {
    return reportAmount(value).replace(/ /g, '.');
  }

  function shortDate(value) {
    const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return match ? match[1] + '.' + match[2] + '.' + match[3].slice(-2) : String(value || '');
  }

  function buildTatooineCashMessage(data) {
    const location = String(data.location || 'ПЕТРОВКА').trim().toUpperCase();
    const lines = [
      'TATOOINE',
      '',
      '🦊 ' + location + '  🦊',
      '📈ОТЧЕТ КАССОВОЙ СМЕНЫ',
      'ДАТА:' + (data.date ? ' ' + shortDate(data.date) : ''),
      '',
      '🪙Общая выручка:' + (hasReportValue(data.totalRevenue) ? ' ' + reportAmount(data.totalRevenue) : ''),
      ''
    ];
    [
      ['🧪 ', 'Безнал', data.bankCards],
      ['🧪 ', 'Нал', data.cashTotal],
      ['🧪 ', 'Онлайн касса 2', data.onlineCashbox2],
      ['📈', 'EatAndSplit', data.eatAndSplit],
      ['🌎', 'Яндекс еда', data.yandexFood]
    ].forEach(item => {
      const value = reportAmount(item[2], true);
      lines.push(item[0] + item[1] + ':' + (value ? ' ' + value : ''), '');
    });
    lines.push('', '', '💀 Расход:' + (hasReportValue(data.expense) ? ' ' + reportAmount(data.expense) : ''));
    if (data.expenseComment) lines.push('Комментарий: ' + String(data.expenseComment).trim());
    lines.push(
      '',
      '🧪 Инкассация:' + (hasReportValue(data.collection) ? ' ' + reportAmount(data.collection) : '') + (hasReportValue(data.collectionActual) ? ' (' + reportAmount(data.collectionActual) + ')' : '')
    );
    lines.push('', '🔠 Неизменный размен [' + reportAmount(data.changeFund, true) + ']');
    const prepaymentsList = (Array.isArray(data.prepayments) ? data.prepayments : []).filter(item => item.date && Number(item.amount) > 0);
    if (prepaymentsList.length) {
      lines.push('', '🔄Предоплаты:', '');
      prepaymentsList.forEach(item => lines.push(shortDate(item.date) + '- ' + prepaymentAmount(item.amount)));
      lines.push('', 'Итого: ' + prepaymentAmount(prepaymentsList.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)));
    }
    return lines.join('\n');
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

  async function prepareOriginalPage(file) {
    const raw = await readFileAsDataUrl(file);
    const image = await loadImage(raw, 'Не удалось открыть фото. Используйте JPG/PNG или сделайте скриншот.');
    const rawWidth = image.naturalWidth || image.width;
    const rawHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, 2200 / Math.max(rawWidth, rawHeight));
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
    return { dataUrl: await canvasToJpeg(canvas, .84), width, height };
  }

  async function preparePage(file) {
    const Scanner = window.DocumentScanner;
    if (typeof Scanner !== 'function') {
      const original = await prepareOriginalPage(file);
      return Object.assign({ id: 'page_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) }, original);
    }
    const scanner = new Scanner({ maxLongSide: 1800, allowOriginal: true });
    const scan = await scanner.process(file,{title:'Проверь документ',confirm:'Использовать скан'});
    if (!scan.confirmed) return null;
    return {
      id: 'page_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      dataUrl: await readFileAsDataUrl(scan.blob),
      width: scan.width,
      height: scan.height,
      usedOriginal: scan.usedOriginal,
      documentDetected: scan.documentDetected
    };
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
    const scale = Math.min(1, 2200 / Math.max(rawWidth, rawHeight));
    const width = Math.max(1, Math.round(rawWidth * scale));
    const height = Math.max(1, Math.round(rawHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = await canvasToJpeg(canvas, .84);
    return { mimeType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), width: canvas.width, height: canvas.height };
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
      for (const file of files) {
        const page = await preparePage(file);
        if (page) pages.push(page);
      }
      renderPages();
      setStatus('', 'Фотографии готовы. Проверьте порядок и нажмите «Распознать отчёт».');
    } catch (error) {
      setStatus('err', String(error && error.message ? error.message : error));
    }
  }

  function usesAndroidTelegramCamera() {
    return Boolean(TG && /Android/i.test(String(navigator.userAgent || '')));
  }

  function stopCameraStream() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    const video = $('cashCameraVideo');
    if (video) video.srcObject = null;
  }

  function closeCamera() {
    stopCameraStream();
    $('cashCameraOverlay').hidden = true;
  }

  async function openCamera() {
    if (!usesAndroidTelegramCamera() || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('cashReportCamera').click();
      return;
    }
    setStatus('', 'Запрашиваю доступ к камере…');
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 3840 },
          height: { ideal: 2160 }
        }
      });
      const video = $('cashCameraVideo');
      video.srcObject = cameraStream;
      $('cashCameraOverlay').hidden = false;
      await video.play();
      setStatus('', 'Камера открыта. Сфотографируйте весь документ.');
    } catch (_) {
      closeCamera();
      setStatus('warn', 'Telegram не дал доступ к камере. Открываю обычный выбор фотографии.');
      $('cashReportCamera').click();
    }
  }

  async function captureCameraPhoto() {
    const video = $('cashCameraVideo');
    const width = Number(video.videoWidth) || 0;
    const height = Number(video.videoHeight) || 0;
    if (!width || !height) {
      setStatus('warn', 'Камера ещё не готова. Подождите секунду и повторите снимок.');
      return;
    }
    const button = $('cashCameraShot');
    button.disabled = true;
    try {
      const track = cameraStream && cameraStream.getVideoTracks ? cameraStream.getVideoTracks()[0] : null;
      let blob = null;
      if (track && typeof ImageCapture === 'function') {
        const capture = new ImageCapture(track);
        try {
          const capabilities = typeof capture.getPhotoCapabilities === 'function'
            ? await capture.getPhotoCapabilities()
            : null;
          const settings = {};
          if (capabilities && capabilities.imageWidth && capabilities.imageWidth.max) {
            settings.imageWidth = capabilities.imageWidth.max;
          }
          if (capabilities && capabilities.imageHeight && capabilities.imageHeight.max) {
            settings.imageHeight = capabilities.imageHeight.max;
          }
          blob = await capture.takePhoto(settings);
        } catch (_) {
          try { blob = await capture.takePhoto(); } catch (_) {}
        }
      }
      if (!blob) {
        const canvas = $('cashCameraCanvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, width, height);
        blob = await new Promise((resolve, reject) => {
          canvas.toBlob(value => {
            if (value) resolve(value);
            else reject(new Error('Не удалось сохранить снимок.'));
          }, 'image/jpeg', .95);
        });
      }
      const file = typeof File === 'function'
        ? new File([blob], 'tatooine-camera-' + Date.now() + '.jpg', { type: blob.type || 'image/jpeg' })
        : blob;
      closeCamera();
      await appendFiles([file]);
    } catch (error) {
      setStatus('err', String(error && error.message ? error.message : error));
    } finally {
      button.disabled = false;
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
    setStatus('', 'Добавьте фотографии отчёта iiko 041 и всех терминальных слипов.');
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
        const message = String(error && error.message || error);
        if (message.includes('Сервер не ответил вовремя.')) {
          // Временная задержка Apps Script не должна сбивать пользователя с текущего шага OCR.
        } else if (Date.now() - started > 30000) {
          throw error;
        }
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
      if (String(result.iikoReportCode || '') === '041') {
        setStatus('ok', 'Отчёт iiko 041 распознан. Проверьте суммы и сверку терминалов.', 1);
      } else {
        setStatus('warn', 'Отчёт iiko 041 не подтверждён. Значения iiko оставлены пустыми — добавьте фотографию отчёта 041.', 1);
      }
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
    setNumber('cashReportCashTotal', (Number(data.cashNonFiscal) || 0) + (Number(data.cashFiscal) || 0));
    setNumber('cashReportOnlineCashbox2', data.onlineCashbox2);
    setNumber('cashReportEatAndSplit', exactPaymentRowAmount(data.paymentRows, ['EatAndSplit']));
    setNumber('cashReportYandexFood', exactPaymentRowAmount(data.paymentRows, ['Яндекс еда', 'Яндекс.Еда', 'Yandex Food']));
    $('cashReportExpense').value = '';
    $('cashReportExpenseComment').value = '';
    setNumber('cashReportCollection', data.collectionAmount);
    setNumber('cashReportCollectionActual', data.collectionActual);
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
  function reportInput(id) { return $(id).value.trim(); }
  function money(value, blankWhenZero) {
    const number = Number(value) || 0;
    if (blankWhenZero && !number) return '';
    return number.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    $('cashReportMessage').value = buildTatooineCashMessage({
      location: CONFIG.reportLocation,
      date: $('cashReportDate').value.trim(),
      totalRevenue: reportInput('cashReportTotalRevenue'),
      bankCards: reportInput('cashReportBankCards'),
      cashTotal: reportInput('cashReportCashTotal'),
      onlineCashbox2: reportInput('cashReportOnlineCashbox2'),
      eatAndSplit: reportInput('cashReportEatAndSplit'),
      yandexFood: reportInput('cashReportYandexFood'),
      expense: reportInput('cashReportExpense'),
      expenseComment: $('cashReportExpenseComment').value.trim(),
      collection: reportInput('cashReportCollection'),
      collectionActual: reportInput('cashReportCollectionActual'),
      changeFund: reportInput('cashReportChangeFund'),
      prepayments
    });
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
      'cashReportDate', 'cashReportTotalRevenue', 'cashReportBankCards', 'cashReportCashTotal',
      'cashReportOnlineCashbox2', 'cashReportEatAndSplit',
      'cashReportYandexFood', 'cashReportExpense',
      'cashReportExpenseComment', 'cashReportCollection', 'cashReportCollectionActual',
      'cashReportChangeFund'
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
        setStatus('ok', 'Обработчик подключён. Добавьте фотографии отчёта iiko 041 и терминальных слипов.');
      }
    } catch (error) {
      setStatus('err', String(error && error.message ? error.message : error));
    }
  }

  function init() {
    window.TatooineAccess = Object.freeze({ can, currentUser: () => currentUser });
    $('appVersion').textContent = String(CONFIG.version || 'v1.0.0');
    $('cashReportChangeFund').value = String(Number(CONFIG.defaultChangeFund) || 0);
    if (TG) {
      try { TG.ready(); TG.expand(); } catch (_) {}
      try { TG.setHeaderColor('#0e1116'); TG.setBackgroundColor('#0e1116'); } catch (_) {}
      try { TG.disableVerticalSwipes(); } catch (_) {}
    }
    $('cashReportCameraButton').addEventListener('click', openCamera);
    $('cashReportCamera').addEventListener('change', async event => { const files = Array.from(event.target.files || []); event.target.value = ''; await appendFiles(files); });
    $('cashReportGallery').addEventListener('change', async event => { const files = Array.from(event.target.files || []); event.target.value = ''; await appendFiles(files); });
    $('cashCameraClose').addEventListener('click', closeCamera);
    $('cashCameraShot').addEventListener('click', captureCameraPhoto);
    $('cashCameraOverlay').addEventListener('click', event => { if (event.target === $('cashCameraOverlay')) closeCamera(); });
    window.addEventListener('pagehide', stopCameraStream);
    $('cashReportReset').addEventListener('click', () => { if (pages.length && !window.confirm('Удалить все фотографии кассового отчёта?')) return; resetAll(); });
    $('cashReportRecognize').addEventListener('click', recognize);
    $('cashReportAddSlip').addEventListener('click', addSlip);
    $('cashReportAddPrepayment').addEventListener('click', addPrepayment);
    $('cashReportSend').addEventListener('click', sendReport);
    $('openCashReport').addEventListener('click', () => showScreen('cash'));
    $('openTaxi').addEventListener('click', openTaxi);
    $('openRoleManagement').addEventListener('click', openRoleManagement);
    $('openRideOriginSettings').addEventListener('click', openRideOriginSettings);
    $('rideConfirm').addEventListener('click', () => setMyRideNeeded(true));
    $('rideCancel').addEventListener('click', () => setMyRideNeeded(false));
    $('rideRouteCalculate').addEventListener('click', calculateRideRoutes);
    $('rideRouteDetails').addEventListener('click', openRideRouteDetails);
    $('rideOptimize').addEventListener('click', optimizeRide);
    $('rideRouteDetailsClose').addEventListener('click', () => { $('rideRouteDetailsDialog').hidden = true; });
    $('rideRouteDetailsDialog').addEventListener('click', event => { if (event.target === $('rideRouteDetailsDialog')) $('rideRouteDetailsDialog').hidden = true; });
    $('rideAddressDialogCancel').addEventListener('click', closeRideAddressDialog);
    $('rideAddressDialogSave').addEventListener('click', () => saveRideAddress(false));
    $('rideAddressDialogClear').addEventListener('click', () => saveRideAddress(true));
    $('rideAddressInput').addEventListener('input', queueRideAddressSuggestions);
    $('rideAddressDialog').addEventListener('click', event => { if (event.target === $('rideAddressDialog')) closeRideAddressDialog(); });
    $('rideOriginEdit').addEventListener('click', openRideOriginDialog);
    $('rideOriginDialogCancel').addEventListener('click', closeRideOriginDialog);
    $('rideOriginDialogSave').addEventListener('click', saveRideOrigin);
    $('rideOriginInput').addEventListener('input', queueRideOriginSuggestions);
    $('rideOriginDialog').addEventListener('click', event => { if (event.target === $('rideOriginDialog')) closeRideOriginDialog(); });
    document.querySelectorAll('[data-open-screen]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.openScreen)));
    bindInputs();
    renderPages();
    checkBackend();
    loadCurrentUser();
  }

  window.TatooineCashTest = Object.freeze({ base64DecodedBytes, validateOcrImages, exactPaymentRowAmount, buildTatooineCashMessage, updateComparison, usesAndroidTelegramCamera, canPermissions });
  init();
})();
