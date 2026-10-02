import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  exactPersonaKey,
  keepPersonaImage,
  keepPersonaMedia,
  keepPersonaName,
  keepPersonaText,
} from './assets/personaLock.js';

test('a shared EA name does not replace the license persona', () => {
  assert.equal(
    keepPersonaName('Ea bulls vpro', 'Apex hunter scalper EA', 'Apex hunter scalper EA'),
    'Ea bulls vpro',
  );
  assert.equal(
    keepPersonaName('Apex hunter scalper EA', 'Ea bulls vpro', ''),
    'Apex hunter scalper EA',
  );
});

test('a blank license can still take its own EA name', () => {
  assert.equal(keepPersonaName('', 'Ea bulls vpro', 'Other mentor'), 'Ea bulls vpro');
  assert.equal(keepPersonaName('Lumo Edge', 'Ea bulls vpro', ''), 'Ea bulls vpro');
  assert.equal(keepPersonaName('', '', 'Mentor bot'), 'Mentor bot');
});

test('tagline and pictures stay on the license that owns them', () => {
  assert.equal(keepPersonaText('Tshifhwa fx', 'Pro scalpser'), 'Tshifhwa fx');
  assert.equal(keepPersonaText('', 'Pro scalpser'), 'Pro scalpser');
  const media = keepPersonaMedia(
    [{ slot: 'bg-1', kind: 'image', url: 'img:license-photo' }],
    [
      { slot: 'bg-1', kind: 'image', url: 'img:other-photo' },
      { slot: 'bg-2', kind: 'image', url: 'img:other-bg' },
    ],
  );
  assert.deepEqual(media.map((item) => item.url), ['img:license-photo']);
  assert.deepEqual(
    keepPersonaMedia([], [{ slot: 'bg-1', kind: 'image', url: 'img:profile' }]).map((item) => item.url),
    ['img:profile'],
  );
  assert.equal(keepPersonaImage('img:license', 'img:profile'), 'img:license');
  assert.equal(keepPersonaImage('', 'img:profile'), 'img:profile');
  assert.equal(keepPersonaImage('blob:temp', 'img:profile'), 'img:profile');
});

test('persona lookup does not treat similar keys as the same license', () => {
  assert.equal(exactPersonaKey('LUMO-AAAA-BBBB-CCC8', 'LUMO-AAAA-BBBB-CCC6'), false);
  assert.equal(exactPersonaKey('LUMO-AAAA-BBBB-CCCB', 'LUMO-AAAA-BBBB-CCC8'), false);
  assert.equal(exactPersonaKey('LUMO-AAAA-BBBB-CCCC', 'lumoaaaabbbbcccc'), true);
  assert.equal(exactPersonaKey('', 'LUMO-AAAA-BBBB-CCCC'), false);
});

test('the live client keeps the license persona when it refreshes branding', () => {
  const branding = readFileSync('assets/clientBrandingSync-CZ-HV4Jg.js', 'utf8');
  const index = readFileSync('assets/index-BN3mw-4aa.js', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  assert.match(branding, /keepPersonaName\(lic\.eaName/);
  assert.match(branding, /exactPersonaKey\(/);
  assert.doesNotMatch(branding, /profile\?\.eaDisplayName/);
  assert.doesNotMatch(branding, /profile\?\.customMedia/);
  assert.match(index, /keepPersonaName\(l\.eaName/);
  assert.doesNotMatch(index, /Tl\(n\?\.name,l\.eaName/);
  assert.match(index, /clientBrandingSync-CZ-HV4Jg\.js\?v=persona1/);
  assert.match(html, /index-BN3mw-4aa\.js\?v=persona1/);
});
