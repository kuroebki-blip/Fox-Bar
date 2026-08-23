const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backend = fs.readFileSync(path.join(__dirname, '../../apps-script/stock/production/Code.gs'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '../../tatooine/app.js'), 'utf8');
const rbacStart = backend.indexOf('// ==== TATOOINE RBAC START ====');
const rbacEnd = backend.indexOf('// ==== TATOOINE RBAC END ====', rbacStart);
const ridesStart = backend.indexOf('// ==== TATOOINE RIDES START ====');
const ridesEnd = backend.indexOf('// ==== TATOOINE RIDES END ====', ridesStart);
const shiftStart = backend.indexOf('const TATOOINE_RIDE_SHIFT_CUTOFF_HOUR');
const shiftEnd = backend.indexOf('function assertTatooineSelfRideRequestOpen_', shiftStart);

assert.ok(ridesStart >= 0, 'Tatooine rides domain must be defined');
assert.ok(ridesEnd > ridesStart, 'Tatooine rides domain must have an end marker');

const source = backend.slice(rbacStart, rbacEnd) + backend.slice(ridesStart, ridesEnd) + backend.slice(shiftStart, shiftEnd);
const rides = new Function(`${source}; return {
  tatooinePermissionsForRole_,
  validateTatooineRideAddress_,
  normalizeGeoapifyRideAddressSuggestions_,
  normalizeTatooineRideDate_,
  getCurrentRideShiftKeyFromLocalParts_,
  latestTatooineRideRequestsForDate_,
  findLatestTatooineRideRequest_,
  upsertTatooineRideRequest_,
  activeTatooineRideRequests_,
  assertTatooineRideAddressAccess_,
  assertTatooineRideRequestAccess_
};`)();

const now = new Date('2026-08-21T18:00:00.000Z');
const employee = { id: 'emp-1', permissions: rides.tatooinePermissionsForRole_('employee') };
const manager = { id: 'mgr-1', permissions: rides.tatooinePermissionsForRole_('manager') };

test('no ride request means the employee is not included in today rides', () => {
  assert.deepEqual(rides.activeTatooineRideRequests_([], '2026-08-21'), []);
});

test('ride shift key switches at 14:00 local restaurant time', () => {
  assert.equal(rides.getCurrentRideShiftKeyFromLocalParts_('2026-08-23', 13, 59), '2026-08-22');
  assert.equal(rides.getCurrentRideShiftKeyFromLocalParts_('2026-08-23', 14, 0), '2026-08-23');
  assert.equal(rides.getCurrentRideShiftKeyFromLocalParts_('2026-08-23', 23, 59), '2026-08-23');
  assert.equal(rides.getCurrentRideShiftKeyFromLocalParts_('2026-08-24', 0, 30), '2026-08-23');
  assert.equal(rides.getCurrentRideShiftKeyFromLocalParts_('2026-08-24', 13, 59), '2026-08-23');
  assert.equal(rides.getCurrentRideShiftKeyFromLocalParts_('2026-08-24', 14, 0), '2026-08-24');
});

test('a prior shift never becomes part of the new current shift', () => {
  const rows = [
    { row: 3, employeeId: 'emp-1', rideDate: '2026-08-22', needsRide: true, updatedAt: now }
  ];
  assert.equal(rides.activeTatooineRideRequests_(rows, '2026-08-23').length, 0);
});

test('employee confirmation creates one active request and repeat confirmation is idempotent', () => {
  const first = rides.upsertTatooineRideRequest_([], 'emp-1', '2026-08-21', true, 'emp-1', now);
  const second = rides.upsertTatooineRideRequest_(first.rows, 'emp-1', '2026-08-21', true, 'emp-1', now);
  assert.equal(second.rows.length, 1);
  assert.equal(rides.activeTatooineRideRequests_(second.rows, '2026-08-21').length, 1);
  assert.equal(second.request.needsRide, true);
});

test('Google Sheets Date cells are normalized before matching and upserting today rides', () => {
  const sheetDate = new Date('2026-08-22T00:00:00.000Z');
  const existing = [{ id: 'ride_emp-1_2026-08-22', employeeId: 'emp-1', rideDate: sheetDate, needsRide: true, createdAt: now }];
  const result = rides.upsertTatooineRideRequest_(existing, 'emp-1', '2026-08-22', true, 'emp-1', now);
  assert.equal(rides.normalizeTatooineRideDate_(sheetDate), '2026-08-22');
  assert.equal(result.rows.length, 1);
  assert.equal(rides.activeTatooineRideRequests_(result.rows, '2026-08-22').length, 1);
});

test('legacy duplicate requests are reduced to the latest state before active rides are listed', () => {
  const rows = [
    { row: 3, employeeId: 'emp-1', rideDate: '2026-08-22', needsRide: true, updatedAt: new Date('2026-08-22T17:00:00.000Z') },
    { row: 4, employeeId: 'emp-1', rideDate: '2026-08-22', needsRide: false, updatedAt: new Date('2026-08-22T17:05:00.000Z') },
    { row: 5, employeeId: 'emp-2', rideDate: '2026-08-22', needsRide: true, updatedAt: new Date('2026-08-22T17:06:00.000Z') }
  ];
  assert.equal(rides.latestTatooineRideRequestsForDate_(rows, '2026-08-22').length, 2);
  assert.deepEqual(rides.activeTatooineRideRequests_(rows, '2026-08-22').map(item => item.employeeId), ['emp-2']);
});

test('manager cancellation updates the same latest request instead of leaving a later active duplicate', () => {
  const rows = [
    { row: 3, id: 'old', employeeId: 'emp-1', rideDate: '2026-08-23', needsRide: true, updatedAt: new Date('2026-08-23T17:00:00.000Z') },
    { row: 4, id: 'new', employeeId: 'emp-1', rideDate: '2026-08-23', needsRide: true, updatedAt: new Date('2026-08-23T17:05:00.000Z') }
  ];
  const latest = rides.findLatestTatooineRideRequest_(rows, 'emp-1', '2026-08-23');
  assert.equal(latest.row, 4);
  const cancelled = rides.upsertTatooineRideRequest_(rows, 'emp-1', '2026-08-23', false, 'mgr-1', new Date('2026-08-23T17:06:00.000Z'));
  assert.equal(cancelled.request.row, 4);
  assert.equal(rides.activeTatooineRideRequests_(cancelled.rows, '2026-08-23').length, 0);
});

test('a cancelled employee can rejoin the same shift without creating a second current request', () => {
  const active = rides.upsertTatooineRideRequest_([], 'emp-1', '2026-08-23', true, 'emp-1', now);
  const cancelled = rides.upsertTatooineRideRequest_(active.rows, 'emp-1', '2026-08-23', false, 'mgr-1', now);
  const rejoined = rides.upsertTatooineRideRequest_(cancelled.rows, 'emp-1', '2026-08-23', true, 'emp-1', now);
  assert.equal(rides.latestTatooineRideRequestsForDate_(rejoined.rows, '2026-08-23').length, 1);
  assert.equal(rides.activeTatooineRideRequests_(rejoined.rows, '2026-08-23').length, 1);
});

test('manager remove refreshes the current route calculation so Matrix and optimization become stale immediately', () => {
  const start = frontend.indexOf('async function setEmployeeRideNeeded');
  const end = frontend.indexOf('function renderRideAddresses', start);
  const handler = frontend.slice(start, end);
  assert.match(handler, /action: 'tatooineSetEmployeeRide'/);
  assert.match(handler, /await writeRide\(\{ action: 'tatooineSetEmployeeRide'/);
  assert.match(handler, /await loadRideManager\(\)/);
  assert.match(handler, /await loadRideRouteCalculation\(\)/);
  assert.match(handler, /await loadRideOptimization\(\)\.catch/);
  assert.match(backend, /const existing = findLatestTatooineRideRequest_\(rows, result\.request\.employeeId, result\.request\.rideDate\)/);
});

test('ride writes use the acknowledged JSONP channel instead of an opaque POST or client polling', () => {
  assert.match(frontend, /async function writeRide\(params\)/);
  assert.match(frontend, /const data = await jsonp\(Object\.assign\(\{\}, params, authParams\(\)\)\)/);
  assert.match(frontend, /await writeRide\(\{ action: 'tatooineSetMyRide'/);
  assert.match(frontend, /await writeRide\(\{ action: 'tatooineSetEmployeeRide'/);
  assert.doesNotMatch(frontend, /TATOOINE_RIDE_WRITE_VERIFY_ATTEMPTS/);
  assert.match(backend, /if \(action === 'tatooineSetMyRide'\) \{\s*return jsonpOutput_\(callback, \{ ok: true, request: setTatooineMyRide_/);
  assert.match(backend, /if \(action === 'tatooineSetEmployeeRide'\) \{\s*return jsonpOutput_\(callback, \{ ok: true, request: setTatooineEmployeeRide_/);
  assert.match(frontend, /setRideStatus\('rideManagerStatus', 'Сохраняю…'\)/);
});

test('employee cancellation removes the employee from active rides and records cancellation', () => {
  const active = rides.upsertTatooineRideRequest_([], 'emp-1', '2026-08-21', true, 'emp-1', now);
  const cancelled = rides.upsertTatooineRideRequest_(active.rows, 'emp-1', '2026-08-21', false, 'emp-1', now);
  assert.equal(rides.activeTatooineRideRequests_(cancelled.rows, '2026-08-21').length, 0);
  assert.ok(cancelled.request.cancelledAt);
});

test('ride address requires non-empty text and never fabricates coordinates', () => {
  assert.throws(() => rides.validateTatooineRideAddress_({ text: '   ' }), /Адрес/);
  assert.deepEqual(rides.validateTatooineRideAddress_({ text: 'Москва, Тверская, 1' }), {
    text: 'Москва, Тверская, 1', latitude: '', longitude: ''
  });
});

test('Geoapify suggestions keep only complete validated addresses with coordinates', () => {
  assert.deepEqual(rides.normalizeGeoapifyRideAddressSuggestions_({ results: [
    { formatted: 'Москва, Тверская улица, 1', lat: 55.757, lon: 37.613 },
    { formatted: 'Некорректный вариант', lat: 'x', lon: 37.613 },
    { formatted: '', lat: 55.7, lon: 37.6 }
  ] }), [{
    text: 'Москва, Тверская улица, 1', latitude: 55.757, longitude: 37.613
  }]);
});

test('employee cannot edit an address or another employee request', () => {
  assert.throws(() => rides.assertTatooineRideAddressAccess_(employee), /Нет доступа/);
  assert.throws(() => rides.assertTatooineRideRequestAccess_(employee, 'emp-2'), /Нет доступа/);
});

test('manager can edit addresses and override an employee ride request', () => {
  assert.doesNotThrow(() => rides.assertTatooineRideAddressAccess_(manager));
  assert.doesNotThrow(() => rides.assertTatooineRideRequestAccess_(manager, 'emp-2'));
});

test('self-service resolves the target from verified current user and not a frontend employee id', () => {
  const start = backend.indexOf('function setTatooineMyRide_');
  const end = backend.indexOf('function setTatooineEmployeeRide_', start);
  const handler = backend.slice(start, end);
  assert.match(handler, /assertTatooineRideRequestAccess_\(user, user\.id\)/);
  assert.equal(handler.includes('targetUserId'), false);
  assert.match(backend, /if \(action === 'tatooineMyRide'\)/);
  assert.match(backend, /if \(action === 'tatooineSetMyRide'\)/);
});

test('manager override endpoint cannot be used by an employee to bypass the self-service deadline', () => {
  const start = backend.indexOf('function setTatooineEmployeeRide_');
  const end = backend.indexOf('function listTatooineTodayRides_', start);
  assert.match(backend.slice(start, end), /hasTatooinePermission_\(user, 'rides\.override'\)/);
});

test('home addresses of other employees are protected by server-side permissions', () => {
  const listStart = backend.indexOf('function listTatooineRideEmployees_');
  const listEnd = backend.indexOf('function setTatooineEmployeeRideAddress_', listStart);
  const handler = backend.slice(listStart, listEnd);
  assert.match(handler, /assertTatooineRideAddressAccess_/);
  assert.match(backend, /requireTatooinePermission_\(auth, 'rides\.view_all'\)/);
  assert.match(frontend, /action: 'tatooineMyRide'/);
  assert.equal(frontend.includes('action: \'tatooineRideEmployees\''), true);
  assert.match(backend, /action === 'tatooineRideAddressSuggestions'/);
  assert.match(backend, /assertTatooineRideAddressAccess_\(getTatooineCurrentUser_\(auth, false\)\)/);
});

test('address autocomplete sends no requests until the manager opens the address dialog and selects coordinates', () => {
  assert.match(frontend, /rideAddressSuggestions/);
  assert.match(frontend, /action: 'tatooineRideAddressSuggestions'/);
  assert.match(frontend, /homeLatitude: selected \? selected\.latitude/);
  assert.match(frontend, /homeLongitude: selected \? selected\.longitude/);
});

test('ride data is loaded lazily when the user opens the ride section', () => {
  const startup = frontend.slice(frontend.indexOf('function init()'), frontend.indexOf('window.TatooineCashTest'));
  assert.equal(startup.includes('loadMyRide()'), false);
  const taxiStart = frontend.indexOf('async function openTaxi()');
  const taxiEnd = frontend.indexOf('function roleLabel(', taxiStart);
  const taxiHandler = frontend.slice(taxiStart, taxiEnd);
  assert.match(taxiHandler, /loadMyRide\(\)/);
  assert.match(taxiHandler, /loadRideManager\(\)/);
});

test('opening taxi serializes Apps Script ride reads so Telegram does not time out or show stale cards', () => {
  const taxiStart = frontend.indexOf('async function openTaxi()');
  const taxiEnd = frontend.indexOf('function roleLabel(', taxiStart);
  const taxiHandler = frontend.slice(taxiStart, taxiEnd);
  assert.doesNotMatch(taxiHandler, /Promise\.all/);
  assert.match(taxiHandler, /await loadMyRide\(\);\n    await loadRideManager\(\);\n    await loadRideAddresses\(\);/);
  assert.match(taxiHandler, /await loadRideRouteCalculation\(\);\n      await loadRideOptimization\(\)\.catch/);
});

test('a failed manager refresh clears stale active ride cards instead of preserving old data', () => {
  const start = frontend.indexOf('async function loadRideManager()');
  const end = frontend.indexOf('function renderRideRouteCalculation', start);
  const handler = frontend.slice(start, end);
  assert.match(handler, /todayRideEmployeeIds = new Set\(\);/);
  assert.match(handler, /list\.replaceChildren\(\);/);
});

test('ride writes fail fast when another ride update holds the document lock', () => {
  const selfStart = backend.indexOf('function setTatooineMyRide_');
  const managerStart = backend.indexOf('function setTatooineEmployeeRide_');
  const managerEnd = backend.indexOf('function listTatooineTodayRides_', managerStart);
  assert.match(backend.slice(selfStart, managerStart), /lock\.tryLock\(3000\)/);
  assert.match(backend.slice(managerStart, managerEnd), /lock\.tryLock\(3000\)/);
});

test('an active ride cannot be created without an address and address deletion cancels today request', () => {
  const selfStart = backend.indexOf('function setTatooineMyRide_');
  const selfEnd = backend.indexOf('function setTatooineEmployeeRide_', selfStart);
  assert.match(backend.slice(selfStart, selfEnd), /Адрес развоза не указан/);
  const addressStart = backend.indexOf('function setTatooineEmployeeRideAddress_');
  const addressHandler = backend.slice(addressStart, backend.indexOf('function setTatooineEmployeeRole_', addressStart));
  assert.match(addressHandler, /saveTatooineRideRequest_\(targetUserId, false, user\.id\)/);
});
