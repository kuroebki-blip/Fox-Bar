const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backend = fs.readFileSync(path.join(__dirname, '../../apps-script/stock/production/Code.gs'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '../../tatooine/app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../../tatooine/index.html'), 'utf8');
const rbacStart = backend.indexOf('// ==== TATOOINE RBAC START ====');
const rbacEnd = backend.indexOf('// ==== TATOOINE RBAC END ====', rbacStart);
const rbacSource = backend.slice(rbacStart, rbacEnd);
const rbac = new Function(`let activeUser = null; function getTatooineCurrentUser_(){ return activeUser; } ${rbacSource}; return { setUser(user){ activeUser = user; }, normalizeTatooineRole_, tatooinePermissionsForRole_, hasTatooinePermission_, requireTatooinePermission_, assertTatooineRoleChangeAllowed_ };`)();
const canPermissions = new Function(`${frontend.slice(frontend.indexOf('function canPermissions('), frontend.indexOf('function can(permission)', frontend.indexOf('function canPermissions(')))}; return canPermissions;`)();

test('employee is fail-closed and cannot manage roles', () => {
  assert.equal(rbac.normalizeTatooineRole_('unknown'), 'employee');
  assert.equal(rbac.hasTatooinePermission_({ permissions: rbac.tatooinePermissionsForRole_('employee') }, 'roles.manage'), false);
});

test('manager has operational permissions but cannot manage settings', () => {
  const permissions = rbac.tatooinePermissionsForRole_('manager');
  assert.ok(permissions.includes('rides.optimize'));
  assert.ok(permissions.includes('rides.confirm'));
  assert.equal(permissions.includes('settings.manage'), false);
});

test('admin can manage settings but cannot assign roles', () => {
  const permissions = rbac.tatooinePermissionsForRole_('admin');
  assert.ok(permissions.includes('settings.manage'));
  assert.ok(permissions.includes('roles.view'));
  assert.equal(permissions.includes('roles.manage'), false);
});

test('superadmin has every configured permission', () => {
  const all = new Set(Object.values(rbacSource.includes('superadmin') ? {
    employee: rbac.tatooinePermissionsForRole_('employee'), manager: rbac.tatooinePermissionsForRole_('manager'), admin: rbac.tatooinePermissionsForRole_('admin'), superadmin: rbac.tatooinePermissionsForRole_('superadmin')
  } : {}).flat());
  const superadmin = new Set(rbac.tatooinePermissionsForRole_('superadmin'));
  all.forEach(permission => assert.ok(superadmin.has(permission)));
});

test('backend requirePermission rejects a request without permission', () => {
  rbac.setUser({ permissions: rbac.tatooinePermissionsForRole_('employee') });
  assert.throws(() => rbac.requireTatooinePermission_({}, 'roles.manage'), /Нет доступа/);
});

test('the last superadmin cannot be demoted', () => {
  assert.throws(() => rbac.assertTatooineRoleChangeAllowed_('1', '1', 'superadmin', 'admin', 1), /последнего superadmin/);
  assert.doesNotThrow(() => rbac.assertTatooineRoleChangeAllowed_('1', '2', 'superadmin', 'admin', 2));
});

test('frontend helper uses permission capabilities, not role text', () => {
  assert.equal(canPermissions({ role: 'employee', permissions: ['rides.optimize'] }, 'rides.optimize'), true);
  assert.equal(canPermissions({ role: 'superadmin', permissions: [] }, 'rides.optimize'), false);
});

test('role changes refresh the current session before rendering role-dependent UI', () => {
  const handlerStart = frontend.indexOf("await post({ action: 'tatooineSetRole'");
  const handlerEnd = frontend.indexOf("showRoleStatus('Роль обновлена.')", handlerStart);
  const handler = frontend.slice(handlerStart, handlerEnd);
  assert.ok(handler.indexOf('await loadCurrentUser();') >= 0);
  assert.equal(handler.indexOf('await loadRoleDirectory();'), -1);
  assert.ok(handler.includes("showScreen('hub')"));
});

test('the app hub exposes role management separately and loads it only on demand', () => {
  assert.match(markup, /id="openCashReport"/);
  assert.match(markup, /id="openTaxi"/);
  assert.match(markup, /id="openRoleManagement"[^>]*hidden/);
  assert.match(markup, /id="roleManagementScreen" hidden/);
  const currentUserStart = frontend.indexOf('async function loadCurrentUser()');
  const currentUserEnd = frontend.indexOf('function jsonp(', currentUserStart);
  const currentUserLoader = frontend.slice(currentUserStart, currentUserEnd);
  assert.equal(currentUserLoader.includes('await loadRoleDirectory()'), false);
  assert.match(frontend, /openRoleManagement.*addEventListener\('click', openRoleManagement\)/);
});
