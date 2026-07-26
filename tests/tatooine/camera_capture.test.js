const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../tatooine/app.js'), 'utf8');

test('Android camera requests a still photo before using the video-frame fallback', () => {
  const imageCapture = source.indexOf("typeof ImageCapture === 'function'");
  const takePhoto = source.indexOf('capture.takePhoto(', imageCapture);
  const drawVideoFrame = source.indexOf('context.drawImage(video', takePhoto);

  assert.ok(imageCapture >= 0, 'ImageCapture support check is missing');
  assert.ok(takePhoto > imageCapture, 'full-resolution takePhoto call is missing');
  assert.ok(drawVideoFrame > takePhoto, 'canvas must remain only after the still-photo attempt');
});
