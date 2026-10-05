import { test, expect, type Page } from '@playwright/test'

// Google sign-in without a Google account: Google's script is replaced by a
// stand-in whose button returns a fixed credential, and /auth/google is
// mocked per test. The admin linking test runs against the live backend.
// E2E_TOKEN / E2E_ADMIN_TOKEN: locally minted session tokens (see speed.spec.ts).

const FAKE_GIS = `
  window.google = { accounts: { id: {
    initialize(o) { window.__gisCallback = o.callback },
    renderButton(el) {
      const b = document.createElement('button');
      b.textContent = 'Sign in with Google'; b.type = 'button';
      b.onclick = () => window.__gisCallback({ credential: 'stub-credential-'.padEnd(40, 'x') });
      el.appendChild(b);
    },
  } } };`

async function withFakeGoogle(page: Page, authGoogle: { status: number; json: object }) {
  await page.route('**/auth/providers', (r) => r.fulfill({ json: { google_client_id: 'test-client.apps.googleusercontent.com' } }))
  await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }))
  const sent: string[] = []
  await page.route('**/auth/google', (r) => {
    sent.push(r.request().postDataJSON().credential)
    return r.fulfill(authGoogle)
  })
  await page.goto('/login')
  return sent
}

test('unlinked Google account is refused with a clear message', async ({ page }) => {
  const sent = await withFakeGoogle(page, {
    status: 403,
    json: { detail: 'No account is linked to this Google address. Ask an administrator to link it.' },
  })
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  await expect(page.getByText('No account is linked to this Google address. Ask an administrator to link it.')).toBeVisible()
  await expect(page.getByText(/Request failed/)).toHaveCount(0)
  expect(sent[0]).toMatch(/^stub-credential-/)
})

test('linked Google account lands in the workspace', async ({ page }) => {
  test.skip(!process.env.E2E_TOKEN, 'set E2E_TOKEN')
  await withFakeGoogle(page, {
    status: 200,
    json: { token: process.env.E2E_TOKEN, expires_in: 43200, username: 'student1', role: 'student' },
  })
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  await expect(page.locator('#question')).toBeVisible({ timeout: 20_000 })
})

test('no Google button when the server has no client ID', async ({ page }) => {
  await page.route('**/auth/providers', (r) => r.fulfill({ json: { google_client_id: null } }))
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /sign in$/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('or', { exact: true })).toHaveCount(0)
})

test('admin links and unlinks a Google email (live backend)', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_TOKEN, 'set E2E_ADMIN_TOKEN')
  await page.addInitScript((t) => localStorage.setItem('text2sql_auth_token', t), process.env.E2E_ADMIN_TOKEN!)
  await page.goto('/')
  await page.getByRole('button', { name: /admin/i }).first().click()
  const panel = page.locator('section', { has: page.locator('#google-title') })
  const input = panel.getByLabel('Google email for student1')
  await expect(input).toBeVisible({ timeout: 20_000 })
  const row = panel.locator('tr', { has: page.getByLabel('Google email for student1') })

  await input.fill('E2E.Link@Example.test')
  await row.getByRole('button', { name: 'Link' }).click()
  await expect(panel.getByText('Saved')).toBeVisible()
  await expect(input).toHaveValue('e2e.link@example.test') // stored lowercased
  await panel.screenshot({ path: test.info().outputPath('google-panel.png') })

  await input.fill('')
  await row.getByRole('button', { name: 'Unlink' }).click()
  await expect(input).toHaveValue('')
  await expect(row.getByRole('button', { name: 'Link' })).toBeDisabled() // nothing to save, nothing linked
})
