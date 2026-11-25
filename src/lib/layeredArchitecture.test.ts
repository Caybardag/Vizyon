import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditFingerprintConsistency,
  buildCoherentFingerprint,
  selectWeightedDeviceProfile,
} from './fingerprintLayer';
import {
  generateBezierMouseTrajectory,
  generateNaturalScrollImpulses,
  generateTypingCadenceMs,
} from './behaviorLayer';
import {
  detectTrafficGateFromPage,
  isQuarantineWorthyBlock,
} from './targetMatcher';

test('buildCoherentFingerprint maintains strict OS-Platform-WebGL-Geo consistency across all seeds', () => {
  const countries = ['DE', 'TR', 'JP', 'BR', 'US', 'PL'];
  for (let i = 0; i < 30; i++) {
    const cc = countries[i % countries.length];
    const fp = buildCoherentFingerprint(`profile-${i}`, { countryCode: cc });
    const audit = auditFingerprintConsistency(fp);
    assert.equal(audit.passed, true, `Consistency failed for seed ${i}: ${audit.warnings.join(', ')}`);
    assert.equal(audit.score, 100);
    assert.equal(fp.consistencyScore, 100);
    assert.ok(fp.viewport.width <= fp.screen.width);
    assert.ok(fp.secChUaPlatform.includes(fp.uaPlatform));
  }

  const deFp = buildCoherentFingerprint('de-slot-1', {
    countryCode: 'DE',
    timezone: 'Europe/Berlin',
    lat: 52.52,
    lon: 13.4,
  });
  assert.equal(deFp.locale, 'de-DE');
  assert.equal(deFp.timezoneId, 'Europe/Berlin');
  assert.ok(Math.abs(deFp.geolocation.latitude - 52.52) <= 0.05);
  assert.ok(Math.abs(deFp.geolocation.longitude - 13.4) <= 0.05);
});

test('auditFingerprintConsistency catches mismatched Windows UA with Linux Mesa WebGL', () => {
  const fp = buildCoherentFingerprint('win-seed', { countryCode: 'US' });
  const broken = {
    ...fp,
    osFamily: 'windows' as const,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    platform: 'Linux x86_64',
    webglRenderer: 'ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics, OpenGL 4.6)',
  };
  const audit = auditFingerprintConsistency(broken);
  assert.equal(audit.passed, false);
  assert.ok(audit.score < 60);
  assert.ok(audit.warnings.some((w) => w.includes('WebGL')));
});

test('selectWeightedDeviceProfile yields realistic multi-OS distribution', () => {
  const seenOs = new Set<string>();
  for (let i = 0; i < 60; i++) {
    seenOs.add(selectWeightedDeviceProfile(`weighted-${i}`).osFamily);
  }
  assert.equal(seenOs.has('windows'), true);
  assert.equal(seenOs.has('macos'), true);
  assert.equal(seenOs.has('linux'), true);
});

test('generateBezierMouseTrajectory creates curved multi-step trajectories rather than straight lines', () => {
  const path = generateBezierMouseTrajectory({ x: 100, y: 120 }, { x: 640, y: 420 }, 42);
  assert.ok(path.length >= 10);
  const last = path[path.length - 1];
  assert.equal(last.x, 640);
  assert.equal(last.y, 420);

  // Verify points deviate from straight linear interpolation
  const mid = path[Math.floor(path.length / 2)];
  const linearMidY = (120 + 420) / 2;
  const linearMidX = (100 + 640) / 2;
  const deviation = Math.hypot(mid.x - linearMidX, mid.y - linearMidY);
  assert.ok(deviation > 5, `Expected curved trajectory deviation > 5px, got ${deviation}`);
});

test('generateNaturalScrollImpulses and generateTypingCadenceMs preserve totals with human variance', () => {
  const impulses = generateNaturalScrollImpulses(320, 17);
  assert.ok(impulses.length >= 3);
  const sum = impulses.reduce((acc, s) => acc + s.deltaY, 0);
  assert.equal(sum, 320);
  assert.ok(impulses.every((s) => s.pauseMs >= 65));

  const negImpulses = generateNaturalScrollImpulses(-250, 99);
  assert.equal(
    negImpulses.reduce((acc, s) => acc + s.deltaY, 0),
    -250
  );

  const delays = generateTypingCadenceMs('hello world query', 11);
  assert.equal(delays.length, 'hello world query'.length);
  assert.ok(delays.every((d) => d >= 45));
});

test('isQuarantineWorthyBlock and detectTrafficGateFromPage trigger rotation on 403/429 and bot gates', () => {
  assert.equal(isQuarantineWorthyBlock(403, 'clear'), true);
  assert.equal(isQuarantineWorthyBlock(429, 'clear'), true);
  assert.equal(isQuarantineWorthyBlock(200, 'bot-gate-detected'), true);
  assert.equal(isQuarantineWorthyBlock(200, 'clear'), false);

  const wafGate = detectTrafficGateFromPage(
    'Checking your browser before accessing example.com',
    'https://example.com',
    '403 Forbidden'
  );
  assert.equal(wafGate.blocked, true);
  assert.equal(wafGate.gateType, 'rate-limit');
});
