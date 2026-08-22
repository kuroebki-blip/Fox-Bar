const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backend = fs.readFileSync(path.join(__dirname, '../../apps-script/stock/production/Code.gs'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '../../tatooine/app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../../tatooine/index.html'), 'utf8');
const rbacStart = backend.indexOf('// ==== TATOOINE RBAC START ====');
const rbacEnd = backend.indexOf('// ==== TATOOINE RBAC END ====', rbacStart);
const ridesStart = backend.indexOf('// ==== TATOOINE RIDES START ====');
const ridesEnd = backend.indexOf('// ==== TATOOINE RIDES END ====', ridesStart);
const source = backend.slice(rbacStart, rbacEnd) + backend.slice(ridesStart, ridesEnd);
const origin = new Function(`${source}; return { validateTatooineRideOrigin_, tatooinePermissionsForRole_ };`)();

test('ride origin requires a non-empty address and never fabricates coordinates', () => {
  assert.throws(() => origin.validateTatooineRideOrigin_({ addressText: '   ' }), /Адрес/);
  assert.deepEqual(origin.validateTatooineRideOrigin_({ addressText: 'Москва, Тверская, 1' }), {
    id: 'tatooine_primary', name: 'Tatooine', addressText: 'Москва, Тверская, 1', latitude: '', longitude: ''
  });
});

test('origin endpoint requires rides.manage_origin on the backend', () => {
  assert.match(backend, /action === 'tatooineRideOrigin'/);
  assert.match(backend, /action === 'tatooineRideOriginSuggestions'/);
  assert.match(backend, /action === 'tatooineSetRideOrigin'/);
  const setStart = backend.indexOf('function setTatooineRideOrigin_');
  const setEnd = backend.indexOf('function setTatooineEmployeeRole_', setStart);
  assert.match(backend.slice(setStart, setEnd), /requireTatooinePermission_\(auth, 'rides\.manage_origin'\)/);
  const suggestionStart = backend.indexOf("if (action === 'tatooineRideOriginSuggestions')");
  const suggestionEnd = backend.indexOf("if (action === 'tatooineRideOrigin')", suggestionStart);
  assert.match(backend.slice(suggestionStart, suggestionEnd), /requireTatooinePermission_\(auth, 'rides\.manage_origin'\)/);
  assert.match(backend, /Tatooine_АудитЛокаций/);
});

test('origin settings are hidden by permission and loaded only when opened', () => {
  assert.match(markup, /id="openRideOriginSettings"[^>]*hidden/);
  assert.match(markup, /id="rideOriginSettingsScreen" hidden/);
  assert.match(frontend, /action: 'tatooineRideOrigin'/);
  assert.match(frontend, /action: 'tatooineSetRideOrigin'/);
  assert.match(frontend, /action: 'tatooineRideOriginSuggestions'/);
  const startup = frontend.slice(frontend.indexOf('function init()'), frontend.indexOf('window.TatooineCashTest'));
  assert.equal(startup.includes('loadRideOrigin()'), false);
});
