import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phoneSnapshotToPatch, stripPhotos } from './api/_lib/phoneRecover.mjs';

test('phone snapshot keeps the license and robot name and drops pictures', () => {
  const patch = phoneSnapshotToPatch({
    'ub-web/session-v2': JSON.stringify({
      accessStatus: 'licensed',
      user: { email: 'student@example.com', firstName: 'Aya', lastName: 'N' },
      bot: {
        licenseKey: 'LUMO-TEST-0001',
        displayName: 'GHOSTFANG PRIME AI',
        name: 'Lumo Edge',
        mainText: 'AL-CAPONE',
        imageUrl: 'data:image/png;base64,AAAA',
        customMedia: [{ slot: 'hero', url: 'blob:http://local/photo' }],
        symbols: ['XAUUSD'],
      },
      passwordSha256: 'should-not-save',
      sessionToken: 'should-not-save',
    }),
    'ub-web/admin-data-v2': JSON.stringify({
      id: 'LM-100001',
      licenses: [
        {
          id: 'lic-1',
          key: 'LUMO-TEST-0002',
          eaName: 'Ea bulls vpro',
          mainText: 'Tshifhwa fx',
          eaImage: 'img:profile-LM-100001',
          clientEmail: 'mentor@example.com',
          status: 'active',
        },
      ],
      clientRequests: [{ email: 'mentor@example.com', status: 'approved', paymentClaimed: true }],
    }),
  });

  const saved = JSON.stringify(patch);
  assert.equal(saved.includes('data:image'), false);
  assert.equal(saved.includes('blob:'), false);
  assert.equal(saved.includes('img:profile'), false);
  assert.equal(saved.includes('should-not-save'), false);
  assert.equal(saved.includes('customMedia'), false);
  assert.equal(patch.vault.some((entry) => entry.key === 'LUMO-TEST-0001' && entry.eaName === 'GHOSTFANG PRIME AI'), true);
  assert.equal(patch.vault.some((entry) => entry.key === 'LUMO-TEST-0001' && entry.mainText === 'AL-CAPONE'), true);
  assert.equal(patch.vault.some((entry) => entry.key === 'LUMO-TEST-0002' && entry.eaName === 'Ea bulls vpro'), true);
  assert.equal(patch.clients.some((entry) => entry.email === 'student@example.com'), true);
  assert.equal(patch.store.workspaces['LM-100001'].licenses[0].eaName, 'Ea bulls vpro');
  assert.equal(patch.images && Object.keys(patch.images).length, 0);
});

test('a long picture string is removed from any saved field', () => {
  const cleaned = stripPhotos({ note: `data:image/jpeg;base64,${'A'.repeat(3000)}`, name: 'Kept' });
  assert.equal(cleaned.note, '');
  assert.equal(cleaned.name, 'Kept');
});
