import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartScanApiKey } from './api/_lib/chartScanKey.mjs';

test('the scanner reads the openai env name already stored on the server', () => {
  const previous = {
    chart: process.env.CHART_SCAN_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    lower: process.env.openai,
  };
  delete process.env.CHART_SCAN_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.openai = 'sk-test-scanner';
  try {
    assert.equal(chartScanApiKey(null), 'sk-test-scanner');
    assert.equal(chartScanApiKey({ apiKey: 'from-firebase' }), 'from-firebase');
  } finally {
    for (const [name, value] of [
      ['CHART_SCAN_API_KEY', previous.chart],
      ['OPENAI_API_KEY', previous.openai],
      ['openai', previous.lower],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
