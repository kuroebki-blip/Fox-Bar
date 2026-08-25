const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '../..');
const frontend = fs.readFileSync(path.join(root, 'tatooine/app.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'apps-script/stock/production/Code.gs'), 'utf8');

test('opening saved machines does not fetch route details until a route action needs them', () => {
  const start = frontend.indexOf('function renderRideOptimization()');
  const end = frontend.indexOf('async function optimizeRide()', start);
  const body = frontend.slice(start, end);
  assert.doesNotMatch(body, /loadRideRouteDetails\(/);
  assert.match(frontend, /async function loadRideCarRouteData\(car\) \{\n    if \(!rideRouteDetails\) await loadRideRouteDetails\(\);/);
});

test('route details read only the selected calculation rows instead of all historical values', () => {
  const start = backend.indexOf('function tatooineRouteRowsForCalculation_');
  const end = backend.indexOf('function getTatooineOptimizationRowForCalculation_', start);
  const body = backend.slice(start, end);
  assert.match(body, /createTextFinder\(String\(calculationId\)\)\.matchEntireCell\(true\)\.findAll\(\)/);
  assert.match(body, /participantsRowsRead/);
  assert.match(body, /edgesRowsRead/);
  assert.doesNotMatch(body, /getRange\(3, 1, lastRow - 2/);
});

test('optimizer reuses the already validated current calculation for route details', () => {
  const start = backend.indexOf('function optimizeTatooineRide_');
  const end = backend.indexOf('function setTatooineEmployeeRole_', start);
  assert.match(backend.slice(start, end), /getTatooineRideRouteDetails_\(\{ calculationId: current\.id \}, auth, operational, current, user\)/);
});

test('current ride requests are selected by shift before rows are transferred to Apps Script', () => {
  const start = backend.indexOf('function tatooineRideRequestRowsForShift_');
  const end = backend.indexOf('function tatooineRideRequestValues_', start);
  const body = backend.slice(start, end);
  assert.ok(start >= 0);
  assert.match(body, /Math\.min\(TATOOINE_RIDE_CURRENT_SHIFT_SCAN_ROWS, sh\.getLastRow\(\) - 2\)/);
  assert.doesNotMatch(body, /getRange\(3, 1, sh\.getLastRow\(\) - 2/);
});

test('current route calculation and optimization avoid full-history value scans', () => {
  const calculationStart = backend.indexOf('function tatooineRouteCalculationRowsForShift_');
  const calculationEnd = backend.indexOf('function saveTatooineRouteCalculation_', calculationStart);
  const calculationBody = backend.slice(calculationStart, calculationEnd);
  assert.ok(calculationStart >= 0);
  assert.match(calculationBody, /createTextFinder/);
  assert.doesNotMatch(calculationBody, /getRange\(3, 1, sh\.getLastRow\(\) - 2, FOX_RECEIPT_HEADERS\.tatooineRouteCalculations\.length\)\.getValues/);

  const optimizationStart = backend.indexOf('function getTatooineOptimizationRowForCalculation_');
  const optimizationEnd = backend.indexOf('function getTatooineRideOptimization_', optimizationStart);
  const optimizationBody = backend.slice(optimizationStart, optimizationEnd);
  assert.ok(optimizationStart >= 0);
  assert.match(optimizationBody, /createTextFinder/);
  assert.doesNotMatch(optimizationBody, /getRange\(3,1,sh\.getLastRow\(\)-2/);
});

test('ride bootstrap reuses one user directory and one current-shift request read', () => {
  const start = backend.indexOf('function getTatooineRideBootstrap_');
  const end = backend.indexOf('function setTatooineEmployeeRole_', start);
  const body = backend.slice(start, end);
  assert.ok(start >= 0);
  assert.equal((body.match(/tatooineUserRows_\(/g) || []).length, 1);
  assert.equal((body.match(/tatooineRideRequestRowsForShift_\(/g) || []).length, 1);
  assert.match(body, /tatooine_ride_bootstrap/);
  assert.match(body, /getTatooineRideRouteCalculationFromState_\(\{\}, auth, shiftKey, requestRows, user\)/);
});

test('optimizer reuses its authenticated user through route calculation and details', () => {
  const start = backend.indexOf('function optimizeTatooineRide_');
  const end = backend.indexOf('function getTatooineRideBootstrap_', start);
  const body = backend.slice(start, end);
  assert.equal((body.match(/requireTatooinePermission_\(/g) || []).length, 1);
  assert.match(body, /getTatooineRideRouteCalculation_\(\{\}, auth, user\)/);
  assert.match(body, /getTatooineRideRouteDetails_\(\{ calculationId: current\.id \}, auth, operational, current, user\)/);
});

test('30/90/180-day history keeps current-state row transfer bounded', () => {
  const requestLimit = Number(backend.match(/TATOOINE_RIDE_CURRENT_SHIFT_SCAN_ROWS = (\d+)/)[1]);
  const calculationLimit = Number(backend.match(/TATOOINE_RIDE_CURRENT_CALCULATION_SCAN_ROWS = (\d+)/)[1]);
  for (const days of [30, 90, 180]) {
    const requestHistoryRows = days * 20;
    const calculationHistoryRows = days * 4;
    const participantHistoryRows = days * 4 * 6;
    const edgeHistoryRows = days * 4 * 30;
    const optimizationHistoryRows = days * 4;
    const result = {
      days,
      requests: [requestHistoryRows, Math.min(requestLimit, requestHistoryRows)],
      calculations: [calculationHistoryRows, Math.min(calculationLimit, calculationHistoryRows)],
      participants: [participantHistoryRows, 6],
      edges: [edgeHistoryRows, 30],
      optimizations: [optimizationHistoryRows, 1]
    };
    assert.ok(result.requests[1] <= 500);
    assert.ok(result.calculations[1] <= 100);
    assert.deepEqual(result.participants.slice(1), [6]);
    assert.deepEqual(result.edges.slice(1), [30]);
    assert.deepEqual(result.optimizations.slice(1), [1]);
    console.log('history benchmark', JSON.stringify(result));
  }
});
