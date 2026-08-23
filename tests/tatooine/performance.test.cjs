const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '../..');
const frontend = fs.readFileSync(path.join(root, 'tatooine/app.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'apps-script/stock/production/Code.gs'), 'utf8');

test('opening saved machines does not fetch route details until a route action needs them', () => {
  const start = frontend.indexOf('async function loadRideOptimization()');
  const end = frontend.indexOf('async function optimizeRide()', start);
  const body = frontend.slice(start, end);
  assert.doesNotMatch(body, /loadRideRouteDetails\(/);
  assert.match(frontend, /async function loadRideCarRouteData\(car\) \{\n    if \(!rideRouteDetails\) await loadRideRouteDetails\(\);/);
});

test('route details read only the selected calculation rows instead of all historical values', () => {
  const start = backend.indexOf('function tatooineRouteRowsForCalculation_');
  const end = backend.indexOf('function tatooineOptimizationRows_', start);
  const body = backend.slice(start, end);
  assert.match(body, /createTextFinder\(String\(calculationId\)\)\.matchEntireCell\(true\)\.findAll\(\)/);
  assert.match(body, /participantsRowsRead/);
  assert.match(body, /edgesRowsRead/);
  assert.doesNotMatch(body, /getRange\(3, 1, lastRow - 2/);
});

test('optimizer reuses the already validated current calculation for route details', () => {
  const start = backend.indexOf('function optimizeTatooineRide_');
  const end = backend.indexOf('function setTatooineEmployeeRole_', start);
  assert.match(backend.slice(start, end), /getTatooineRideRouteDetails_\(\{ calculationId: current\.id \}, auth, operational, current\)/);
});
