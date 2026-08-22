const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backend = fs.readFileSync(path.join(__dirname, '../../apps-script/stock/production/Code.gs'), 'utf8');
const rbacStart = backend.indexOf('// ==== TATOOINE RBAC START ====');
const rbacEnd = backend.indexOf('// ==== TATOOINE RBAC END ====', rbacStart);
const ridesStart = backend.indexOf('// ==== TATOOINE RIDES START ====');
const ridesEnd = backend.indexOf('// ==== TATOOINE RIDES END ====', ridesStart);
const source = backend.slice(rbacStart, rbacEnd) + backend.slice(ridesStart, ridesEnd);

const routing = new Function(`${source}; return {
  buildTatooineRoutePoints_,
  normalizeGeoapifyRouteMatrix_,
  isTatooineRouteCoordinatePairValid_,
  tatooineRouteInputFingerprint_
};`)();

const origin = { id: 'origin', type: 'origin', name: "Fo'x", addressText: 'Москва, Тверская, 1', latitude: 55.757, longitude: 37.613 };
const employees = [
  { employeeId: 'emp-a', name: 'Анна', address: { text: 'Москва, Арбат, 1', latitude: 55.752, longitude: 37.592 } },
  { employeeId: 'emp-b', name: 'Борис', address: { text: 'Москва, Мира, 10', latitude: 55.78, longitude: 37.633 } },
  { employeeId: 'emp-c', name: 'Вера', address: { text: 'Москва, Ленина, 5', latitude: 55.72, longitude: 37.66 } }
];

function matrixFor(points) {
  return {
    sources: points.map(point => ({ original_location: [point.longitude, point.latitude] })),
    targets: points.map(point => ({ original_location: [point.longitude, point.latitude] })),
    sources_to_targets: points.map((_, sourceIndex) => points.map((__, targetIndex) => ({
      distance: sourceIndex * 1000 + targetIndex * 100 + 10,
      time: sourceIndex * 100 + targetIndex * 10 + 1,
      source_index: sourceIndex,
      target_index: targetIndex
    })))
  };
}

test('restaurant and one employee produce stable route point IDs and two directed edges', () => {
  const points = routing.buildTatooineRoutePoints_(origin, [employees[0]]);
  const matrix = routing.normalizeGeoapifyRouteMatrix_(matrixFor(points), points);

  assert.deepEqual(points.map(point => point.id), ['origin', 'employee_emp-a']);
  assert.equal(matrix.points.length, 2);
  assert.equal(matrix.edges.length, 2);
  assert.deepEqual(matrix.edges.map(edge => [edge.fromId, edge.toId]), [
    ['origin', 'employee_emp-a'],
    ['employee_emp-a', 'origin']
  ]);
});

test('restaurant and three employees create a full directed matrix without self-edges', () => {
  const points = routing.buildTatooineRoutePoints_(origin, employees);
  const matrix = routing.normalizeGeoapifyRouteMatrix_(matrixFor(points), points);

  assert.equal(matrix.points.length, 4);
  assert.equal(matrix.edges.length, 12);
  assert.ok(matrix.edges.some(edge => edge.fromId === 'employee_emp-a' && edge.toId === 'employee_emp-c'));
  assert.ok(matrix.edges.some(edge => edge.fromId === 'employee_emp-c' && edge.toId === 'employee_emp-a'));
});

test('A to B and B to A are retained as independent values', () => {
  const points = routing.buildTatooineRoutePoints_(origin, employees.slice(0, 2));
  const raw = matrixFor(points);
  raw.sources_to_targets[1][2] = { distance: 1800, time: 420, source_index: 1, target_index: 2 };
  raw.sources_to_targets[2][1] = { distance: 2300, time: 600, source_index: 2, target_index: 1 };
  const matrix = routing.normalizeGeoapifyRouteMatrix_(raw, points);
  const forward = matrix.edges.find(edge => edge.fromId === 'employee_emp-a' && edge.toId === 'employee_emp-b');
  const reverse = matrix.edges.find(edge => edge.fromId === 'employee_emp-b' && edge.toId === 'employee_emp-a');

  assert.deepEqual(forward, { fromId: 'employee_emp-a', toId: 'employee_emp-b', distanceMeters: 1800, durationSeconds: 420, status: 'ok' });
  assert.deepEqual(reverse, { fromId: 'employee_emp-b', toId: 'employee_emp-a', distanceMeters: 2300, durationSeconds: 600, status: 'ok' });
});

test('missing route is normalized as unreachable, never as a zero-cost route', () => {
  const points = routing.buildTatooineRoutePoints_(origin, [employees[0]]);
  const raw = matrixFor(points);
  raw.sources_to_targets[0][1] = null;
  const matrix = routing.normalizeGeoapifyRouteMatrix_(raw, points);
  const edge = matrix.edges.find(item => item.fromId === 'origin' && item.toId === 'employee_emp-a');

  assert.deepEqual(edge, { fromId: 'origin', toId: 'employee_emp-a', distanceMeters: null, durationSeconds: null, status: 'unreachable' });
});

test('invalid coordinates, including 0,0, are rejected before a provider request', () => {
  assert.equal(routing.isTatooineRouteCoordinatePairValid_(55.75, 37.61), true);
  assert.equal(routing.isTatooineRouteCoordinatePairValid_(0, 0), false);
  assert.equal(routing.isTatooineRouteCoordinatePairValid_(NaN, 37.61), false);
  assert.throws(() => routing.buildTatooineRoutePoints_({ ...origin, latitude: '', longitude: '' }, [employees[0]]), /Точка начала/);
});

test('invalid Geoapify response is rejected instead of being silently guessed', () => {
  const points = routing.buildTatooineRoutePoints_(origin, [employees[0]]);
  assert.throws(() => routing.normalizeGeoapifyRouteMatrix_({ sources_to_targets: [] }, points), /матриц/);
});

test('the calculation fingerprint changes when the active ride composition changes', () => {
  const one = routing.tatooineRouteInputFingerprint_(origin, [employees[0]]);
  const two = routing.tatooineRouteInputFingerprint_(origin, employees.slice(0, 2));
  const changedAddress = routing.tatooineRouteInputFingerprint_(origin, [{ ...employees[0], address: { ...employees[0].address, latitude: 55.751 } }]);

  assert.notEqual(one, two);
  assert.notEqual(one, changedAddress);
});

test('route calculation endpoints are server-side protected by rides.optimize and absent from employee startup', () => {
  assert.match(backend, /action === 'tatooineCalculateRideRoutes'/);
  assert.match(backend, /action === 'tatooineRideRouteCalculation'/);
  assert.match(backend, /action === 'tatooineRideRouteDetails'/);
  const calculateStart = backend.indexOf('function calculateTatooineRideRoutes_');
  const calculateEnd = backend.indexOf('function getTatooineRideRouteCalculation_', calculateStart);
  assert.match(backend.slice(calculateStart, calculateEnd), /requireTatooinePermission_\(auth, 'rides\.optimize'\)/);
});

test('stored route calculations and optimizations normalize Google Sheets date cells before current-day lookup', () => {
  assert.match(backend, /rideDate: normalizeTatooineRideDate_\(r\[1\]\), status:/);
  assert.match(backend, /routeCalculationId:String\(r\[1\]\|\|''\),rideDate:normalizeTatooineRideDate_\(r\[2\]\)/);
});
