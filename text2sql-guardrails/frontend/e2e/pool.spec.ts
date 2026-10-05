import { test, expect, type Route } from '@playwright/test'

// Admin screen's AI key pool panel. The pool API is mocked at the network
// layer, so this runs without the LiteLLM container. E2E_ADMIN_TOKEN: a
// locally minted admin session token (see speed.spec.ts for how).
const token = process.env.E2E_ADMIN_TOKEN
test.skip(!token, 'set E2E_ADMIN_TOKEN to run against the live backend')

const base = {
  configured: true,
  reachable: true,
  app_provider: 'litellm',
  providers: ['openai', 'anthropic', 'gemini', 'groq', 'mistral'],
}
const groq = { id: 'm1', provider: 'groq', model: 'llama-3.3-70b-versatile', label: 'Team key', key_hint: 'x9Qa', requests: 41, avg_latency_ms: 612 }
const gemini = { id: 'm2', provider: 'gemini', model: 'gemini-2.5-flash', label: '', key_hint: 'Lk2P', requests: 17, avg_latency_ms: 1480 }

test('admin adds, health-checks and removes a pool key', async ({ page }) => {
  let deployments = [groq]
  const sent: unknown[] = []
  await page.route('**/v1/admin/llm-pool', async (route: Route) => {
    if (route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON())
      deployments = [groq, gemini]
      return route.fulfill({ status: 201, json: { ...base, deployments } })
    }
    return route.fulfill({ json: { ...base, deployments } })
  })
  await page.route('**/v1/admin/llm-pool/health', (r) =>
    r.fulfill({ json: { healthy: ['m1'], unhealthy: [{ id: 'm2', error: 'AuthenticationError: API key not valid' }] } }))
  await page.route('**/v1/admin/llm-pool/m2', (r) => {
    deployments = [groq]
    return r.fulfill({ json: { ...base, deployments } })
  })

  await page.addInitScript((t) => localStorage.setItem('text2sql_auth_token', t), token!)
  await page.goto('/')
  await page.getByRole('button', { name: /admin/i }).first().click()
  const panel = page.locator('section', { has: page.locator('#pool-title') })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText('Serving app queries')).toBeVisible()
  await expect(panel.getByText('••••x9Qa')).toBeVisible()

  // Add a key: the full key goes to the API once and is never rendered.
  await panel.getByLabel('Provider').selectOption('gemini')
  await expect(panel.getByLabel('Model')).toHaveAttribute('placeholder', 'gemini-2.5-flash')
  await panel.getByLabel('Model').fill('gemini-2.5-flash')
  await panel.getByLabel('API key').fill('AIza-test-key-Lk2P')
  await panel.getByRole('button', { name: 'Add key' }).click()
  await expect(panel.getByText('••••Lk2P')).toBeVisible()
  expect(sent).toEqual([{ provider: 'gemini', model: 'gemini-2.5-flash', api_key: 'AIza-test-key-Lk2P', label: '' }])
  await expect(page.getByText('AIza-test-key-Lk2P')).toHaveCount(0)
  await expect(panel.getByLabel('API key')).toHaveValue('')

  await panel.getByRole('button', { name: 'Check health' }).click()
  await expect(panel.getByText('AuthenticationError: API key not valid')).toBeVisible()
  await expect(panel.getByLabel('Healthy')).toHaveCount(1)
  await panel.screenshot({ path: test.info().outputPath('pool-panel.png') })

  // Remove needs a second click to confirm.
  const row = panel.locator('tr', { hasText: 'gemini-2.5-flash' })
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(row.getByRole('button', { name: 'Confirm remove' })).toBeVisible()
  await row.getByRole('button', { name: 'Confirm remove' }).click()
  await expect(panel.getByText('••••Lk2P')).toHaveCount(0)
})

test('panel explains setup when the pool is not configured', async ({ page }) => {
  await page.route('**/v1/admin/llm-pool', (r) =>
    r.fulfill({ json: { ...base, configured: false, reachable: false, app_provider: 'gemini', deployments: [] } }))
  await page.addInitScript((t) => localStorage.setItem('text2sql_auth_token', t), token!)
  await page.goto('/')
  await page.getByRole('button', { name: /admin/i }).first().click()
  const panel = page.locator('section', { has: page.locator('#pool-title') })
  await expect(panel.getByText('Not configured')).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText('docker compose up -d litellm')).toBeVisible()
})
