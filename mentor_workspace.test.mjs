import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectImageKeys,
  loadMentorBundle,
  ownedByMentor,
  scopeWorkspace,
} from './api/_lib/mentorWorkspace.mjs';

test('keeps only the signed-in mentor EAs from a polluted workspace', () => {
  const scoped = scopeWorkspace(
    {
      eas: [
        { id: 'mine', ownerAdminId: 'LM-308135', name: 'Vasiom', imageUrl: 'img:profile-LM-308135' },
        { id: 'other', ownerAdminId: 'LM-004821', name: 'Unlimited bull' },
      ],
      licenses: [
        {
          key: 'LUMO-MINE',
          ownerAdminId: 'LM-308135',
          eaImage: 'img:profile-LM-308135',
          customMedia: [{ url: 'img:LM-308135-bg-1' }],
        },
        { key: 'LUMO-OTHER', ownerAdminId: 'LM-004821' },
      ],
      clientRequests: [{ email: 'student@example.com' }],
    },
    'LM-308135',
  );
  assert.equal(scoped.eas.length, 1);
  assert.equal(scoped.eas[0].id, 'mine');
  assert.equal(scoped.licenses.length, 1);
  assert.equal(scoped.licenses[0].key, 'LUMO-MINE');
  assert.equal(scoped.clientRequests.length, 1);
  const keys = collectImageKeys(scoped, 'LM-308135');
  assert.ok(keys.includes('profile-LM-308135'));
  assert.ok(keys.includes('LM-308135-bg-1'));
  assert.ok(!keys.includes('profile-LM-004821'));
});

test('ownedByMentor never treats another mentor id as self', () => {
  assert.equal(ownedByMentor({ ownerAdminId: 'LM-308135' }, 'LM-308135'), true);
  assert.equal(ownedByMentor({ ownerAdminId: 'LM-004821' }, 'LM-308135'), false);
  assert.equal(ownedByMentor({ adminId: 'LM-308135' }, 'LM-308135'), true);
});

test('loadMentorBundle returns only that mentor vault keys and skips other workspaces', async () => {
  const io = {
    async read(path) {
      if (path === 'lumo/store/workspaces/LM-308135') {
        return {
          eas: [
            { id: 'mine', ownerAdminId: 'LM-308135', name: 'Vasiom' },
            { id: 'leak', ownerAdminId: 'LM-931417', name: 'Leaked' },
          ],
          licenses: [{ key: 'LUMO-MINE', ownerAdminId: 'LM-308135', eaImage: 'img:ea-vasiom' }],
        };
      }
      if (path === 'lumo/vault') {
        return [
          { key: 'LUMO-MINE', ownerAdminId: 'LM-308135', status: 'assigned' },
          { key: 'LUMO-SUPER', ownerAdminId: 'LM-004821', status: 'assigned' },
          { key: 'LUMO-DEAD', ownerAdminId: 'LM-308135', status: 'deleted' },
        ];
      }
      if (path === 'lumo/revokedKeys') return ['OLD-KEY'];
      if (path === 'lumo/updatedAt') return '2026-09-14T21:00:00.000Z';
      return null;
    },
  };
  const bundle = await loadMentorBundle('LM-308135', io);
  assert.equal(bundle.workspace.eas.length, 1);
  assert.equal(bundle.workspace.eas[0].id, 'mine');
  assert.deepEqual(
    bundle.vault.map((row) => row.key),
    ['LUMO-MINE'],
  );
  assert.ok(bundle.imageKeys.includes('ea-vasiom'));
  assert.deepEqual(bundle.revokedKeys, ['OLD-KEY']);
  assert.equal(bundle.updatedAt, '2026-09-14T21:00:00.000Z');
});
