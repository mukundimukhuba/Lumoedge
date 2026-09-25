import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyWebsitePatch,
  assertWebsiteOwner,
  parsePrice,
  publicWebsiteView,
  publishRequirements,
  slugifyRobotName,
  uniqueSlug,
} from './api/_lib/websiteStore.mjs';

test('robot names become clean unique slugs', () => {
  assert.equal(slugifyRobotName('Unlimited Bull'), 'unlimited-bull');
  const taken = new Map([['unlimited-bull', 'web-A']]);
  assert.equal(uniqueSlug('Unlimited Bull', taken, 'web-A'), 'unlimited-bull');
  assert.equal(uniqueSlug('Unlimited Bull', taken, 'web-B'), 'unlimited-bull-2');
});

test('only mentor-owned image URLs are kept', () => {
  const website = applyWebsitePatch(
    { mentorId: 'LM-1' },
    { robotImage: '/api/images/web-robot-LM-2', mentorImage: '/api/images/web-mentor-LM-1' },
    'LM-1',
  );
  assert.equal(website.robotImage, '');
  assert.equal(website.mentorImage, '/api/images/web-mentor-LM-1');
});

test('publish requires custom iPhone and Android prices and durations', () => {
  const draft = applyWebsitePatch(
    { robotName: '' },
    {
      robotName: 'Gold Robot',
      iphonePrice: 'R600',
      iphoneDuration: '30 Days',
      androidPrice: 'R500',
      androidDuration: '30 Days',
    },
    'LM-1',
  );
  const check = publishRequirements(draft);
  assert.equal(check.ok, true);
  assert.equal(check.iphone.display, 'R600');
  assert.equal(parsePrice('nope').ok, false);
  assert.deepEqual(publishRequirements({ robotName: 'X' }).missing, [
    'iphonePrice',
    'androidPrice',
    'iphoneDuration',
    'androidDuration',
  ]);
});

test('public view hides drafts and only exposes two pricing cards', () => {
  const draft = { status: 'draft', robotName: 'Secret', iphonePrice: 'R1', androidPrice: 'R2' };
  assert.equal(publicWebsiteView(draft), null);
  const live = publicWebsiteView({
    websiteId: 'web-1',
    slug: 'gold-robot',
    status: 'published',
    robotName: 'Gold Robot',
    iphonePrice: 'R1000',
    iphoneDuration: '3 Months',
    androidPrice: 'R800',
    androidDuration: '3 Months',
    whatsapp: '+27820000000',
    email: '',
  });
  assert.equal(live.pricing.iphone.duration, '3 Months');
  assert.equal(live.pricing.android.price, 'R800');
  assert.equal(live.contacts.whatsapp, '+27820000000');
  assert.equal(live.contacts.email, undefined);
});

test('another mentor cannot edit a website they do not own', () => {
  const website = { websiteId: 'web-1', mentorId: 'LM-1' };
  assert.equal(assertWebsiteOwner(website, { ok: true, adminId: 'LM-2', role: 'admin' }).error, 'forbidden');
  assert.equal(assertWebsiteOwner(website, { ok: true, adminId: 'LM-1', role: 'admin' }).ok, true);
  assert.equal(assertWebsiteOwner(website, { ok: true, adminId: 'LM-9', role: 'super' }).ok, true);
});
