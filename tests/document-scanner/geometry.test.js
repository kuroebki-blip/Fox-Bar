const assert = require('node:assert/strict');
const test = require('node:test');
const geometry = require('../../shared/document-scanner/geometry.js');

test('sortCorners returns a stable clockwise document order', () => {
  const corners = geometry.sortCorners([{x:90,y:10},{x:8,y:92},{x:12,y:11},{x:94,y:96}]);
  assert.deepEqual(corners, {topLeft:{x:12,y:11},topRight:{x:90,y:10},bottomRight:{x:94,y:96},bottomLeft:{x:8,y:92}});
  assert.equal(geometry.isConvex(corners), true);
});

test('outputSize preserves proportions and does not upscale', () => {
  const size = geometry.outputSize({topLeft:{x:0,y:0},topRight:{x:3000,y:0},bottomRight:{x:3000,y:4000},bottomLeft:{x:0,y:4000}}, 2400);
  assert.deepEqual(size, {width:1800,height:2400});
  assert.deepEqual(geometry.scaleCorners({topLeft:{x:1,y:2}}, 2), {topLeft:{x:2,y:4}});
});
