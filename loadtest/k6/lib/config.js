// Shared configuration for the BaseAPIKey load tests.
//
// Every scenario reads its target from the environment so that no script
// contains a hard coded host. The defaults point at a local sandbox, and a
// target that looks like production is refused unless the operator sets
// ALLOW_EXTERNAL_TARGET=1 explicitly.

const DEFAULT_BASE_URL = 'http://127.0.0.1:3310';
const DEFAULT_API_KEY = 'sk_live_stagingvalidationkey0000000000000000';
const DEFAULT_MODEL = 'demo-model';

/** Hosts that must never be used by an automated load test. */
const PRODUCTION_HOST_PATTERN = /(^|[.\-])prod([.\-]|$)|production/i;

function readEnv(name, fallback) {
  const value = __ENV[name];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * Refuses an unsafe target.
 *
 * - the default target is the local sandbox
 * - a target that looks like production needs an explicit override
 * - the target must be an absolute http(s) URL
 */
export function assertSafeTarget(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new Error(`BASE_URL is not a valid URL: ${baseUrl}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`BASE_URL must use http or https, got ${parsed.protocol}`);
  }
  if (
    PRODUCTION_HOST_PATTERN.test(parsed.hostname) &&
    readEnv('ALLOW_EXTERNAL_TARGET', '') !== '1'
  ) {
    throw new Error(
      `Refusing to load test "${parsed.hostname}": it looks like a production host. ` +
        'Set ALLOW_EXTERNAL_TARGET=1 only for a target that is explicitly approved.',
    );
  }
  return baseUrl;
}

export const CONFIG = {
  baseUrl: assertSafeTarget(readEnv('BASE_URL', DEFAULT_BASE_URL)),
  apiKey: readEnv('API_KEY', DEFAULT_API_KEY),
  model: readEnv('MODEL', DEFAULT_MODEL),
  /** The provider mode of the stub upstream: ok, slow, error, hanging. */
  stubMode: readEnv('STUB_MODE', 'ok'),
  /** The number of concurrent virtual users of a scenario. */
  vus: Number(readEnv('VUS', '20')),
  /** The duration of a scenario in seconds. */
  duration: readEnv('DURATION', '60s'),
  /** The request rate of a scenario. */
  rate: Number(readEnv('RATE', '20')),
};

/**
 * The planning targets. They are test targets, not a statement about the
 * capacity of the application. The levels are run one after another.
 */
export const PROFILES = {
  low: { rate: 116, vus: 24, duration: '120s' },
  medium: { rate: 300, vus: 60, duration: '180s' },
  high: { rate: 600, vus: 120, duration: '180s' },
  extreme: { rate: 1150, vus: 230, duration: '240s' },
};

export function profile() {
  const name = readEnv('PROFILE', 'low');
  const selected = PROFILES[name];
  if (!selected) {
    throw new Error(`Unknown PROFILE "${name}". Use one of: ${Object.keys(PROFILES).join(', ')}`);
  }
  return { name, ...selected };
}

/**
 * The regression thresholds. A scenario fails when a threshold is violated,
 * so the same numbers can be used in a pipeline.
 */
export function thresholds(options = {}) {
  const p95 = options.p95 ?? 500;
  const p99 = options.p99 ?? 1500;
  const failedRate = options.failedRate ?? 0.01;
  return {
    http_req_failed: [`rate<${failedRate}`],
    http_req_duration: [`p(95)<${p95}`, `p(99)<${p99}`],
    checks: ['rate>0.99'],
  };
}
