import { test, expect } from '@playwright/test'

// Needs the real backend on :8000 with an LLM key. E2E_TOKEN is a session
// token for a student account, minted locally so the test never handles a
// password. From text2sql-guardrails/:
//   venv/Scripts/python -c "from app.auth import create_token; print(create_token(<student user_id>))"

const token = process.env.E2E_TOKEN
test.skip(!token, 'set E2E_TOKEN to run against the live backend')

const QUESTIONS = [
  'How many students are there in each department?',
  'Show my attendance percentage by subject',
  'Which subjects have the most students enrolled?',
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('text2sql_auth_token', t), token!)
})

test('answers arrive under 3 s and the score refines in place', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  const input = page.locator('#question')
  await expect(input).toBeVisible({ timeout: 15_000 })

  const totals: number[] = []
  for (const q of QUESTIONS) {
    await input.fill(q)
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/v1/query') && r.request().method() === 'POST'),
      input.press('Enter'),
    ])
    const body = await res.json()
    expect(body.status).toBe('success')
    const total = body.timings_ms.total as number
    totals.push(total)
    expect(res.headers()['server-timing']).toContain('generation;dur=')

    // Latency readout shows the server total and opens to a breakdown.
    const meter = page.locator('details.latency')
    await expect(meter).toBeVisible()
    await meter.locator('summary').click()
    await expect(meter.getByText('SQL generation')).toBeVisible()
    await meter.locator('summary').click()

    if (body.confidence_pending) {
      await expect(page.getByText(/verifying 1 check/)).toBeVisible()
      // Final score replaces the provisional one without a reload.
      await expect(page.getByText(/verifying 1 check/)).toBeHidden({ timeout: 90_000 })
    }
  }
  console.log('server totals (ms):', totals.join(', '))
  const sorted = [...totals].sort((a, b) => a - b)
  expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(3000) // median
})
