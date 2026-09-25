import { firebasePostClientEntry, firebaseRead, firebaseWrite } from './clientMerge.mjs';
import { requireSuper, verifyAdminSession } from './adminSession.mjs';
import {
  applyWebsitePatch,
  assertWebsiteOwner,
  checkoutMessage,
  emptyWebsite,
  generateLicenseKey,
  ownerWebsiteView,
  parsePrice,
  publicWebsiteUrl,
  publicWebsiteView,
  publishRequirements,
  slugifyRobotName,
  superWebsiteRow,
  toList,
  uniqueSlug,
  whatsappHref,
} from './websiteStore.mjs';

function sessionHeaders(req) {
  return verifyAdminSession(req);
}

async function loadAllWebsites(io) {
  const raw = (await io.read('lumo/websites')) || {};
  return toList(raw);
}

async function loadWebsite(io, websiteId) {
  if (!websiteId) return null;
  const row = await io.read(`lumo/websites/${websiteId}`);
  return row && typeof row === 'object' ? row : null;
}

async function loadWebsiteForMentor(io, mentorId) {
  const mapped = await io.read(`lumo/mentorWebsites/${mentorId}`);
  const websiteId = typeof mapped === 'string' ? mapped : mapped?.websiteId;
  if (websiteId) {
    const row = await loadWebsite(io, websiteId);
    if (row) return row;
  }
  const all = await loadAllWebsites(io);
  return all.find((row) => String(row?.mentorId || '') === String(mentorId || '')) || null;
}

async function slugMap(io) {
  const raw = (await io.read('lumo/websiteSlugs')) || {};
  const map = new Map();
  if (raw && typeof raw === 'object') {
    for (const [slug, value] of Object.entries(raw)) {
      const id = typeof value === 'string' ? value : value?.websiteId;
      if (slug && id) map.set(slug, id);
    }
  }
  return map;
}

async function saveWebsite(io, website) {
  await io.write(`lumo/websites/${website.websiteId}`, website);
  await io.write(`lumo/mentorWebsites/${website.mentorId}`, website.websiteId);
  if (website.slug) {
    await io.write(`lumo/websiteSlugs/${website.slug}`, website.websiteId);
  }
  return website;
}

async function seedFromWorkspace(io, mentorId, admin) {
  const ws = (await io.read(`lumo/store/workspaces/${mentorId}`)) || {};
  const eas = toList(ws.eas);
  const ea = eas[0] || {};
  const profile = ws.profile && typeof ws.profile === 'object' ? ws.profile : {};
  return emptyWebsite(mentorId, {
    eaId: ea.id || '',
    robotName: ea.name || profile.eaDisplayName || '',
    robotImage: ea.imageUrl || ea.eaImage || profile.eaImage || '',
    mentorName: admin?.fullName || profile.firstName || profile.mentorName || '',
    email: admin?.email || profile.email || '',
    headline: profile.mainText || '',
  });
}

async function fulfillStoreOrder(io, order, website) {
  const platform = order.platform === 'android' ? 'android' : 'iphone';
  const duration = platform === 'android' ? website.androidDuration : website.iphoneDuration;
  const price = platform === 'android' ? website.androidPrice : website.iphonePrice;
  const licenseKey = generateLicenseKey();
  const now = new Date().toISOString();
  const license = {
    id: `lic-${Date.now()}`,
    key: licenseKey,
    eaId: website.eaId || '',
    eaName: website.robotName || 'Lumo Edge',
    eaImage: website.robotImage || '',
    ownerAdminId: website.mentorId,
    clientName: order.customerName,
    clientEmail: order.customerEmail,
    duration,
    platform,
    price,
    status: 'active',
    source: 'store-website',
    createdAt: now,
  };

  const workspace =
    (await io.read(`lumo/store/workspaces/${website.mentorId}`)) || {
      id: website.mentorId,
      eas: [],
      licenses: [],
      clientRequests: [],
      mt5: {},
      profile: {},
      orders: [],
      revokedKeys: [],
    };
  const licenses = toList(workspace.licenses).filter((row) => row?.key !== licenseKey);
  workspace.licenses = [license, ...licenses];
  workspace.id = website.mentorId;
  await io.write(`lumo/store/workspaces/${website.mentorId}`, workspace);

  const vault = toList((await io.read('lumo/vault')) || []);
  vault.unshift({
    key: licenseKey,
    adminId: website.mentorId,
    ownerAdminId: website.mentorId,
    status: 'active',
    clientEmail: order.customerEmail,
    clientName: order.customerName,
    eaName: license.eaName,
    duration,
    createdAt: now,
  });
  await io.write('lumo/vault', vault);

  try {
    const { notifyLicenseKey } = await import('./email/index.mjs');
    const { markMentorActivitySatisfied } = await import('./mentorActivity.mjs');
    void notifyLicenseKey(
      { firebaseRead, firebaseWrite, firebasePush: null },
      {
        ...license,
        email: order.customerEmail,
        clientEmail: order.customerEmail,
        ownerAdminId: website.mentorId,
      },
    ).catch(() => undefined);
    await markMentorActivitySatisfied(website.mentorId, 'license');
    await markMentorActivitySatisfied(website.mentorId, 'client');
  } catch {
    /* never block fulfillment */
  }

  return { licenseKey, duration, price, platform };
}

export async function handleWebsiteRoutes(req, res, ctx) {
  const { json, readBody, pathname } = ctx || {};
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  const io = { read: firebaseRead, write: firebaseWrite };

  if (path === '/api/websites' && req.method === 'GET') {
    const session = await sessionHeaders(req);
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const rows = (await loadAllWebsites(io)).map(superWebsiteRow).filter(Boolean);
    json(res, 200, { ok: true, websites: rows });
    return true;
  }

  if (path === '/api/websites/me' && req.method === 'GET') {
    const session = await sessionHeaders(req);
    if (!session.ok) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const website = await loadWebsiteForMentor(io, session.adminId);
    json(res, 200, { ok: true, website: ownerWebsiteView(website) });
    return true;
  }

  if (path === '/api/websites/me/orders' && req.method === 'GET') {
    const session = await sessionHeaders(req);
    if (!session.ok) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const all = toList((await io.read('lumo/storeOrders')) || {});
    const rows = all
      .filter((row) => String(row?.mentorId || '') === String(session.adminId || '') || session.role === 'super')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 40)
      .map((row) => ({
        orderId: row.orderId,
        platform: row.platform,
        amount: row.amountDisplay,
        duration: row.duration,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        status: row.status,
        createdAt: row.createdAt,
        paidAt: row.paidAt || '',
      }));
    json(res, 200, { ok: true, orders: rows });
    return true;
  }

  if (path === '/api/websites/me' && req.method === 'POST') {
    const session = await sessionHeaders(req);
    if (!session.ok) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const existing = await loadWebsiteForMentor(io, session.adminId);
    if (existing) {
      json(res, 200, { ok: true, website: ownerWebsiteView(existing), created: false });
      return true;
    }
    const website = await seedFromWorkspace(io, session.adminId, { email: session.email });
    await saveWebsite(io, website);
    json(res, 201, { ok: true, website: ownerWebsiteView(website), created: true });
    return true;
  }

  if (path === '/api/websites/me' && req.method === 'PUT') {
    const session = await sessionHeaders(req);
    if (!session.ok) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    let website = await loadWebsiteForMentor(io, session.adminId);
    if (!website) {
      website = await seedFromWorkspace(io, session.adminId, { email: session.email });
    }
    const body = await readBody(req);
    const next = applyWebsitePatch(website, body || {}, session.adminId);
    await saveWebsite(io, next);
    json(res, 200, { ok: true, website: ownerWebsiteView(next) });
    return true;
  }

  if (path === '/api/websites/me/publish' && req.method === 'POST') {
    const session = await sessionHeaders(req);
    if (!session.ok) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const body = await readBody(req);
    let website = await loadWebsiteForMentor(io, session.adminId);
    if (!website) website = await seedFromWorkspace(io, session.adminId, { email: session.email });
    website = applyWebsitePatch(website, body || {}, session.adminId);
    const check = publishRequirements(website);
    if (!check.ok) {
      json(res, 400, { ok: false, error: 'missing_required_fields', missing: check.missing });
      return true;
    }
    const taken = await slugMap(io);
    const slug = uniqueSlug(website.robotName || slugifyRobotName('lumo-robot'), taken, website.websiteId);
    if (website.slug && website.slug !== slug) {
      await io.write(`lumo/websiteSlugs/${website.slug}`, null);
    }
    const now = new Date().toISOString();
    website = {
      ...website,
      slug,
      status: 'published',
      publishedAt: website.publishedAt || now,
      updatedAt: now,
      iphonePrice: check.iphone.display,
      androidPrice: check.android.display,
      disabledAt: '',
      disabledReason: '',
    };
    await saveWebsite(io, website);
    json(res, 200, {
      ok: true,
      message: 'Your Lumo Edge website is now live.',
      website: ownerWebsiteView(website),
    });
    return true;
  }

  if (path === '/api/websites/me/unpublish' && req.method === 'POST') {
    const session = await sessionHeaders(req);
    if (!session.ok) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const website = await loadWebsiteForMentor(io, session.adminId);
    if (!website) {
      json(res, 404, { ok: false, error: 'not_found' });
      return true;
    }
    const next = { ...website, status: 'unpublished', updatedAt: new Date().toISOString() };
    await saveWebsite(io, next);
    json(res, 200, { ok: true, website: ownerWebsiteView(next) });
    return true;
  }

  if (path.startsWith('/api/websites/') && req.method === 'PATCH') {
    const session = await sessionHeaders(req);
    if (!requireSuper(session)) {
      json(res, 403, { ok: false, error: 'Access denied' });
      return true;
    }
    const websiteId = decodeURIComponent(path.replace('/api/websites/', ''));
    const website = await loadWebsite(io, websiteId);
    if (!website) {
      json(res, 404, { ok: false, error: 'not_found' });
      return true;
    }
    const body = await readBody(req);
    const action = String(body?.status || body?.action || '').toLowerCase();
    let next = { ...website, updatedAt: new Date().toISOString() };
    if (action === 'disabled' || action === 'disable') {
      next.status = 'disabled';
      next.disabledAt = new Date().toISOString();
      next.disabledReason = String(body?.reason || 'Disabled by Super Admin').slice(0, 200);
    } else if (action === 'published' || action === 'enable' || action === 're-enable') {
      const check = publishRequirements(website);
      if (!check.ok) {
        json(res, 400, { ok: false, error: 'missing_required_fields', missing: check.missing });
        return true;
      }
      next.status = 'published';
      next.publishedAt = next.publishedAt || new Date().toISOString();
      next.disabledAt = '';
      next.disabledReason = '';
    } else if (action === 'unpublished' || action === 'unpublish') {
      next.status = 'unpublished';
    } else {
      json(res, 400, { ok: false, error: 'invalid_status' });
      return true;
    }
    await saveWebsite(io, next);
    json(res, 200, { ok: true, website: superWebsiteRow(next) });
    return true;
  }

  if (path.startsWith('/api/store/') && path.endsWith('/checkout') && req.method === 'POST') {
    const slug = decodeURIComponent(path.replace('/api/store/', '').replace(/\/checkout$/, ''));
    const websiteId = (await slugMap(io)).get(slug);
    const website = websiteId ? await loadWebsite(io, websiteId) : null;
    const pub = publicWebsiteView(website);
    if (!pub) {
      json(res, 404, { ok: false, error: 'not_found' });
      return true;
    }
    const body = await readBody(req);
    const platform = String(body?.platform || '').toLowerCase() === 'android' ? 'android' : 'iphone';
    const email = String(body?.email || '').trim().toLowerCase();
    const name = String(body?.name || body?.fullName || '').trim();
    if (!email || !email.includes('@')) {
      json(res, 400, { ok: false, error: 'valid email required' });
      return true;
    }
    const price = parsePrice(platform === 'android' ? website.androidPrice : website.iphonePrice);
    if (!price.ok) {
      json(res, 400, { ok: false, error: 'invalid_price' });
      return true;
    }
    const duration = platform === 'android' ? website.androidDuration : website.iphoneDuration;
    const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const firstName = name.split(/\s+/)[0] || email.split('@')[0];
    const lastName = name.split(/\s+/).slice(1).join(' ');
    const client = await firebasePostClientEntry({
      email,
      firstName,
      lastName,
      status: 'pending',
      paymentClaimed: false,
      paymentVerified: false,
    }).catch(() => null);
    if (website.mentorId) {
      try {
        const { markMentorActivitySatisfied } = await import('./mentorActivity.mjs');
        await markMentorActivitySatisfied(website.mentorId, 'client');
      } catch {
        /* ignore */
      }
    }
    const order = {
      orderId,
      websiteId: website.websiteId,
      mentorId: website.mentorId,
      slug,
      platform,
      amount: price.value,
      amountDisplay: price.display,
      duration,
      robotName: website.robotName,
      customerName: name || firstName,
      customerEmail: email,
      clientId: client?.id || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await io.write(`lumo/storeOrders/${orderId}`, order);
    const payMessage = checkoutMessage(website, platform, orderId);
    json(res, 201, {
      ok: true,
      order: {
        orderId,
        platform,
        amount: price.display,
        duration,
        robotName: website.robotName,
        status: 'pending',
        checkoutPath: `/store/${slug}/checkout/${orderId}`,
      },
      payment: {
        provider: 'mentor_configured',
        whatsapp: whatsappHref(website, payMessage),
        email: website.email || '',
      },
    });
    return true;
  }

  if (path.startsWith('/api/store/orders/') && req.method === 'GET') {
    const orderId = decodeURIComponent(path.replace('/api/store/orders/', ''));
    const order = await io.read(`lumo/storeOrders/${orderId}`);
    if (!order) {
      json(res, 404, { ok: false, error: 'not_found' });
      return true;
    }
    json(res, 200, {
      ok: true,
      order: {
        orderId: order.orderId,
        platform: order.platform,
        amount: order.amountDisplay,
        duration: order.duration,
        robotName: order.robotName,
        status: order.status,
        customerEmail: order.customerEmail,
        paidAt: order.paidAt || '',
      },
    });
    return true;
  }

  if (path.startsWith('/api/store/orders/') && path.endsWith('/claim') && req.method === 'POST') {
    const orderId = decodeURIComponent(path.replace('/api/store/orders/', '').replace(/\/claim$/, ''));
    const order = await io.read(`lumo/storeOrders/${orderId}`);
    if (!order) {
      json(res, 404, { ok: false, error: 'not_found' });
      return true;
    }
    if (order.status === 'paid') {
      json(res, 200, { ok: true, order: { orderId, status: 'paid' } });
      return true;
    }
    const next = {
      ...order,
      status: 'claimed',
      paymentClaimedAt: new Date().toISOString(),
    };
    await io.write(`lumo/storeOrders/${orderId}`, next);
    json(res, 200, { ok: true, order: { orderId, status: 'claimed' } });
    return true;
  }

  if (
    (path.startsWith('/api/store/orders/') && path.endsWith('/confirm') && req.method === 'POST') ||
    (path === '/api/store/pay/webhook' && req.method === 'POST')
  ) {
    const body = await readBody(req);
    const session = await sessionHeaders(req);
    const webhookSecret = String(process.env.LUMO_STORE_WEBHOOK_SECRET || '').trim();
    const incomingSecret = String(body?.secret || req.headers['x-lumo-store-secret'] || '').trim();
    const webhookOk = Boolean(webhookSecret && incomingSecret && incomingSecret === webhookSecret);
    if (!session.ok && !webhookOk) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    const orderId = path === '/api/store/pay/webhook'
      ? String(body?.orderId || '').trim()
      : decodeURIComponent(path.replace('/api/store/orders/', '').replace(/\/confirm$/, ''));
    const order = await io.read(`lumo/storeOrders/${orderId}`);
    if (!order) {
      json(res, 404, { ok: false, error: 'not_found' });
      return true;
    }
    if (session.ok && session.role !== 'super' && String(session.adminId) !== String(order.mentorId)) {
      json(res, 403, { ok: false, error: 'forbidden' });
      return true;
    }
    if (order.status === 'paid' && order.licenseKey) {
      json(res, 200, { ok: true, alreadyPaid: true, orderId, licenseSent: true });
      return true;
    }
    const website = await loadWebsite(io, order.websiteId);
    if (!website) {
      json(res, 404, { ok: false, error: 'website_missing' });
      return true;
    }
    const fulfilled = await fulfillStoreOrder(io, order, website);
    const paid = {
      ...order,
      status: 'paid',
      paidAt: new Date().toISOString(),
      licenseKey: fulfilled.licenseKey,
      confirmedBy: session.adminId || 'webhook',
    };
    await io.write(`lumo/storeOrders/${orderId}`, paid);
    json(res, 200, {
      ok: true,
      orderId,
      status: 'paid',
      licenseSent: true,
      platform: fulfilled.platform,
    });
    return true;
  }

  if (path.startsWith('/api/store/') && req.method === 'GET') {
    const slug = decodeURIComponent(path.replace('/api/store/', ''));
    if (!slug || slug.includes('/')) return false;
    const websiteId = (await slugMap(io)).get(slug);
    const website = websiteId ? await loadWebsite(io, websiteId) : null;
    const pub = publicWebsiteView(website);
    if (!pub) {
      json(res, 404, { ok: false, error: 'not_found' });
      return true;
    }
    json(res, 200, { ok: true, website: pub });
    return true;
  }

  return false;
}
