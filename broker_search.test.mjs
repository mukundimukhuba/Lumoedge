import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BROKER_SEED,
  companiesFromCatalog,
  liveSearchCompanies,
  mapLiveSearchCompanies,
  mergeBrokerCompanies,
} from './api/_lib/brokers.mjs';

const catalog = BROKER_SEED.map((b) => ({ ...b, enabled: true }));

test('live MT5 Search rows expose company, not only companyName', () => {
  const mapped = mapLiveSearchCompanies(
    [
      {
        companyName: 'Exness (CY) Ltd',
        results: [{ name: 'ExnessCY-LP_Real1', access: ['1.2.3.4:443'] }],
      },
      {
        companyName: 'XM Global Limited',
        results: [{ name: 'XMGlobal-MT5', access: ['5.6.7.8:443'] }],
      },
    ],
    catalog,
  );
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].company, 'Exness (CY) Ltd');
  assert.equal(mapped[0].companyName, 'Exness (CY) Ltd');
  assert.equal(mapped[0].results[0].name, 'ExnessCY-LP_Real1');
  assert.equal(mapped[1].company, 'XM Global Limited');
  assert.ok(mapped.every((row) => !/razor/i.test(row.company)));
});

test('catalog search is not Razor-only', () => {
  const hits = companiesFromCatalog(catalog, 'Exness');
  assert.ok(hits.every((row) => /exness/i.test(row.company)));
  const all = companiesFromCatalog(catalog, '');
  const names = all.map((row) => row.company.toLowerCase());
  assert.ok(names.some((n) => n.includes('razor')));
  assert.ok(
    names.some((n) => n.includes('ic markets') || n.includes('deriv') || n.includes('xm')),
    'seed catalog must include non-Razor brokers with servers when present',
  );
});

test('merge keeps live servers and does not drop non-Razor companies', () => {
  const live = mapLiveSearchCompanies(
    [
      {
        companyName: 'Pepperstone Group Limited',
        results: [{ name: 'Pepperstone-MT5', access: ['9.9.9.9:443'] }],
      },
    ],
    catalog,
  );
  const extra = companiesFromCatalog(catalog, 'Razor');
  const merged = mergeBrokerCompanies(live, extra);
  assert.ok(merged.some((row) => /pepperstone/i.test(row.company)));
  assert.ok(merged.some((row) => /razor/i.test(row.company)));
});

test('liveSearchCompanies uses upstream Search for any query', async () => {
  const fetchFn = async (url) => {
    assert.match(url, /\/Search\?company=ICMarkets/);
    return {
      ok: true,
      async json() {
        return [
          {
            companyName: 'Raw Trading Ltd',
            results: [{ name: 'ICMarketsSC-MT5', access: ['10.0.0.1:443'] }],
          },
        ];
      },
    };
  };
  const rows = await liveSearchCompanies('ICMarkets', catalog, fetchFn);
  assert.ok(rows.some((row) => row.company === 'Raw Trading Ltd'));
  assert.ok(rows.some((row) => row.results.some((s) => s.name === 'ICMarketsSC-MT5')));
});
