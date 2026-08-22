const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontend = fs.readFileSync(path.join(__dirname, '../../tatooine/app.js'), 'utf8');
const start = frontend.indexOf('function buildYandexMapsNativeRouteUrl');
const end = frontend.indexOf('async function loadRideRouteDetails', start);
const buildYandexMapsNativeRouteUrl = new Function(`${frontend.slice(start, end)}; return buildYandexMapsNativeRouteUrl;`)();
const origin = { latitude: 55.75, longitude: 37.61 };
const points = [
  { latitude: 55.76, longitude: 37.62 },
  { latitude: 55.77, longitude: 37.63 },
  { latitude: 55.78, longitude: 37.64 }
];

test('native Yandex Maps route URL preserves the supplied 1, 2, or 3 dropoff points', () => {
  for (const count of [1, 2, 3]) {
    const url = new URL(buildYandexMapsNativeRouteUrl(origin, points.slice(0, count)));
    assert.equal(url.protocol, 'yandexmaps:');
    assert.equal(url.searchParams.get('rtt'), 'auto');
    assert.deepEqual(url.searchParams.get('rtext').split('~'), [origin].concat(points.slice(0, count)).map(point => `${point.latitude},${point.longitude}`));
  }
});

test('Yandex route controls use optimizer dropoffOrder, Telegram external navigation and rides.optimize', () => {
  assert.match(frontend, /car\.dropoffOrder/);
  assert.match(frontend, /Открыть в Яндекс Картах/);
  assert.match(frontend, /Скопировать маршрут/);
  assert.match(frontend, /can\('rides\.optimize'\)/);
  assert.match(frontend, /TG\.openLink\(buildYandexMapsNativeRouteUrl/);
  assert.doesNotMatch(frontend, /window\.location\.assign\(buildYandexMaps/);
});
