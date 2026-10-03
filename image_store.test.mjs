import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageObjectPath, parseDataUrl } from './api/_lib/imageStore.mjs';

test('image keys stay inside the private folder and picture bytes parse', () => {
  assert.equal(imageObjectPath('profile-LM-100001'), 'images/profile-LM-100001');
  assert.equal(imageObjectPath('../secret'), 'images/secret');
  const parsed = parseDataUrl('data:image/png;base64,aGVsbG8=');
  assert.equal(parsed.contentType, 'image/png');
  assert.equal(parsed.buffer.toString('utf8'), 'hello');
  assert.equal(parseDataUrl('https://example.com/photo.png'), null);
});
