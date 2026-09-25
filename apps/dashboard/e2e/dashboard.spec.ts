import { expect, test } from '@playwright/test';

const MOCK_API_KEY = ['sk', 'live', 'e2e', 'secret'].join('_');

test('signs in, restores a secure session, navigates, creates a key, and signs out', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to your console' })).toBeVisible();

  const loginForm = page.locator('#login-form');
  await loginForm.getByLabel('Email').fill('admin@example.com');
  await loginForm.getByLabel('Password').fill('Password123!');
  await loginForm.getByRole('button', { name: /Continue/ }).click();

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('API operational')).toBeVisible();
  await expect(page.getByText('42', { exact: true }).first()).toBeVisible();

  const refreshCookie = (await context.cookies()).find(
    (cookie) => cookie.name === 'bak_refresh_token',
  );
  expect(refreshCookie?.httpOnly).toBe(true);
  expect(refreshCookie?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => window.localStorage.getItem('bak_refresh_token'))).toBeNull();

  await page.evaluate(() => {
    window.sessionStorage.removeItem('bak_access_token');
    window.sessionStorage.removeItem('bak_user');
  });
  await page.reload();
  await expect(page.locator('#page-title')).toHaveText('Overview');
  await expect(page.locator('#user-name')).toHaveText('Admin Example');

  await page.evaluate(() => window.sessionStorage.setItem('bak_access_token', 'expired-token'));
  await page.reload();
  await expect(page.locator('#page-title')).toHaveText('Overview');
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('bak_access_token')))
    .toMatch(/^access-refreshed-/);

  const statsBefore = (await (await page.request.get('http://127.0.0.1:3100/__stats')).json()) as {
    refreshCalls: number;
  };
  await page.request.post('http://127.0.0.1:3100/__expire-access');
  await page.locator('#refresh-button').click();
  await expect(page.getByText('42', { exact: true }).first()).toBeVisible();
  await expect
    .poll(async () => {
      const stats = (await (await page.request.get('http://127.0.0.1:3100/__stats')).json()) as {
        refreshCalls: number;
      };
      return stats.refreshCalls;
    })
    .toBe(statsBefore.refreshCalls + 1);

  await page.getByRole('button', { name: 'API keys' }).click();
  await expect(page.locator('#page-title')).toHaveText('API keys');
  await page.getByRole('button', { name: 'Create key' }).last().click();
  await page.locator('dialog input[name="name"]').fill('E2E key');
  await page.locator('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Copy this key now.')).toBeVisible();
  await expect(page.getByText(MOCK_API_KEY)).toBeVisible();
  await page.locator('dialog').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Usage' }).click();
  await expect(page.locator('#page-title')).toHaveText('Usage');
  await expect(page.locator('#usage-table').getByText('gpt-demo')).toBeVisible();

  await page.getByRole('button', { name: 'Models' }).click();
  await expect(page.locator('#page-title')).toHaveText('Models');
  await expect(page.getByText('GPT Demo')).toBeVisible();

  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.locator('#page-title')).toHaveText('Billing');
  await expect(page.locator('#billing-metrics').getByText('$25.00')).toBeVisible();

  await page.locator('button[data-view="admin"]').click();
  await expect(page.locator('#page-title')).toHaveText('Admin');
  await expect(page.locator('#provider-table').getByText('Nine Router')).toBeVisible();
  await expect(page.locator('#provider-table').getByText('HEALTHY')).toBeVisible();

  await page.getByTitle('Sign out').click();
  await expect(page.getByRole('heading', { name: 'Sign in to your console' })).toBeVisible();
  expect(
    (await context.cookies()).find((cookie) => cookie.name === 'bak_refresh_token'),
  ).toBeUndefined();
});
