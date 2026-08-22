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

assert.ok(ridesStart >= 0, 'Tatooine rides domain must be defined');
assert.ok(ridesEnd > ridesStart, 'Tatooine rides domain must have an end marker');

const source = backend.slice(rbacStart, rbacEnd) + backend.slice(ridesStart, ridesEnd);
const rides = new Function(`${source}; return {
  tatooinePermissionsForRole_,
  validateTatooineRideAddress_,
  normalizeGeoapifyRideAddressSuggestions_,
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

test('employee confirmation creates one active request and repeat confirmation is idempotent', () => {
  const first = rides.upsertTatooineRideRequest_([], 'emp-1', '2026-08-21', true, 'emp-1', now);
  const second = rides.upsertTatooineRideRequest_(first.rows, 'emp-1', '2026-08-21', true, 'emp-1', now);
  assert.equal(second.rows.length, 1);
  assert.equal(rides.activeTatooineRideRequests_(second.rows, '2026-08-21').length, 1);
  assert.equal(second.request.needsRide, true);
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

test('an active ride cannot be created without an address and address deletion cancels today request', () => {
  const selfStart = backend.indexOf('function setTatooineMyRide_');
  const selfEnd = backend.indexOf('function setTatooineEmployeeRide_', selfStart);
  assert.match(backend.slice(selfStart, selfEnd), /Адрес развоза не указан/);
  const addressStart = backend.indexOf('function setTatooineEmployeeRideAddress_');
  const addressHandler = backend.slice(addressStart, backend.indexOf('function setTatooineEmployeeRole_', addressStart));
  assert.match(addressHandler, /saveTatooineRideRequest_\(targetUserId, false, user\.id\)/);
});
