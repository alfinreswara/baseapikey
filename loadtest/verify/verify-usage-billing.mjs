// Verifies the usage tracking and the credit ledger after a load test.
//
// The script compares the usage rows and the credit transactions of the
// staging database with the requests that the load test sent. It only reads
// the database.
//
//   DATABASE_URL=postgresql://... node loadtest/verify/verify-usage-billing.mjs
//
// The optional window limits the check to the rows that were created during
// the load test.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:55441/baseapikey';
const WINDOW_MINUTES = Number(process.env['WINDOW_MINUTES'] ?? '10');
const EXPECTED_REQUESTS = Number(process.env['EXPECTED_REQUESTS'] ?? '0');

// The Prisma client of the workspace is used, so the verification runs
// against the same client generation as the application.
const PRISMA_CLIENT =
  process.env['PRISMA_CLIENT'] ??
  new URL('../../apps/gateway/node_modules/@prisma/client/default.js', import.meta.url).pathname;
const { PrismaClient } = await import(PRISMA_CLIENT);

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

const usages = await prisma.usage.findMany({
  where: { createdAt: { gte: since } },
  orderBy: { createdAt: 'asc' },
});
const transactions = await prisma.creditTransaction.findMany({
  where: { createdAt: { gte: since } },
  orderBy: { createdAt: 'asc' },
});
const accounts = await prisma.billingAccount.findMany();

let failures = 0;
function check(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!passed) failures += 1;
}

const requestIds = usages.map((usage) => usage.requestId);
const duplicates = requestIds.filter((id, index) => requestIds.indexOf(id) !== index);
check(
  'every usage event has a unique request id',
  duplicates.length === 0,
  `usages=${usages.length} duplicates=${duplicates.length}`,
);

// A successful request has to be priced, a failed one must not add cost.
const successful = usages.filter((usage) => usage.statusCode === 200);
const withoutCost = successful.filter((usage) => Number(usage.estimatedCost) === 0);
check(
  'the successful requests carry a cost',
  withoutCost.length === 0,
  `successful=${successful.length} without cost=${withoutCost.length}`,
);
const failedWithCost = usages.filter(
  (usage) => usage.statusCode !== 200 && Number(usage.estimatedCost) > 0,
);
check(
  'the failed requests do not add cost',
  failedWithCost.length === 0,
  `failed with cost=${failedWithCost.length}`,
);

const usageKeys = new Set(transactions.map((transaction) => transaction.idempotencyKey));
const missingCharge = usages.filter(
  (usage) => Number(usage.estimatedCost) > 0 && !usageKeys.has(`usage:${usage.id}`),
);
check(
  'every priced usage has exactly one ledger entry',
  missingCharge.length === 0,
  `usages=${usages.length} transactions=${transactions.length} missing=${missingCharge.length}`,
);

const duplicatedCharge = transactions.filter(
  (transaction, index) =>
    transactions.findIndex((other) => other.idempotencyKey === transaction.idempotencyKey) !==
    index,
);
check(
  'the ledger does not contain a duplicated idempotency key',
  duplicatedCharge.length === 0,
  `duplicates=${duplicatedCharge.length}`,
);

for (const account of accounts) {
  const accountTransactions = transactions.filter(
    (transaction) => transaction.billingAccountId === account.id,
  );
  const expected = accountTransactions.reduce(
    (sum, transaction) => sum + transaction.amountCents,
    account.creditBalanceCents -
      accountTransactions.reduce((sum, transaction) => sum + transaction.amountCents, 0),
  );
  check(
    `the balance of the account ${account.id} matches its ledger`,
    expected === account.creditBalanceCents,
    `balance=${account.creditBalanceCents} expected=${expected}`,
  );
}

if (EXPECTED_REQUESTS > 0) {
  check(
    'the number of recorded usage events matches the requests that were sent',
    usages.length >= EXPECTED_REQUESTS,
    `usages=${usages.length} expected>=${EXPECTED_REQUESTS}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nThe usage tracking and the credit ledger are consistent.');
}

await prisma.$disconnect();
