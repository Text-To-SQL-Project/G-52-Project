import { test, expect, type Page } from '@playwright/test'

// Section 7: motion that must behave, not just look good. Canned /v1/query
// (no LLM calls). E2E_ADMIN_TOKEN: locally minted admin token (see speed.spec.ts).
const token = process.env.E2E_ADMIN_TOKEN
test.skip(!token, 'set E2E_ADMIN_TOKEN')

const ANSWER = {
  query_id: 'q_motion', status: 'success', question: 'Students per department', timestamp: new Date().toISOString(),
  sql: 'SELECT 1;', explanation: '', tables_used: [], columns_used: [],
  results: { columns: ['department', 'students'], rows: Array.from({ length: 12 }, (_, i) => [`Dept ${i}`, 100 + i]), row_count: 12, truncated: false },
  confidence: { score: 0.9, label: 'High', calibrated: true, signals: [{ key: 'sql_validity', label: 'SQL Validity', score: 1, status: 'pass', detail: 'ok' }] },
  confidence_pending: false, timings_ms: { generation: 900, total: 950 },
  guardrail: { passed: true, blocked_reasons: [], checks_run: [] }, warnings: [],
}

async function signIn(page: Page) {
  await page.addInitScript((t) => localStorage.setItem('text2sql_auth_token', t), token!)
  // Count WebGL draws so "the orb is paused" is measured, not assumed.
  await page.addInitScript(() => {
    const w = window as unknown as { __draws: number }
    w.__draws = 0
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const fn of ['drawArrays', 'drawElements'] as const) {
        const proto = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
        const orig = proto[fn]
        proto[fn] = function (this: unknown, ...a: unknown[]) { w.__draws++; return orig.apply(this, a) }
      }
    }
  })
  await page.goto('/')
  await expect(page.locator('#question')).toBeVisible({ timeout: 30_000 })
}
const drawsOver = async (page: Page, ms: number) => {
  const a = await page.evaluate(() => (window as unknown as { __draws: number }).__draws)
  await page.waitForTimeout(ms)
  return (await page.evaluate(() => (window as unknown as { __draws: number }).__draws)) - a
}

test('orb renders on the workspace and stops when it is not visible', async ({ page }) => {
  await signIn(page)
  await page.waitForTimeout(1500) // orb chunk + first frames
  expect(await drawsOver(page, 1000)).toBeGreaterThan(5) // clearly drawing; exact fps depends on the machine
  await page.getByRole('button', { name: /history/i }).first().click()
  await page.waitForTimeout(600)
  expect(await drawsOver(page, 1000)).toBe(0)
  await page.getByRole('button', { name: /workspace/i }).first().click()
  await page.waitForTimeout(600)
  expect(await drawsOver(page, 1000)).toBeGreaterThan(5) // clearly drawing; exact fps depends on the machine
})

test('"/" focuses the question, Esc leaves it', async ({ page }) => {
  await signIn(page)
  await page.locator('body').click({ position: { x: 5, y: 300 } })
  await page.keyboard.press('/')
  await expect(page.locator('#question')).toBeFocused()
  await expect(page.locator('#question')).toHaveValue('') // the "/" itself isn't typed
  await page.keyboard.press('Escape')
  await expect(page.locator('#question')).not.toBeFocused()
})

test('running border while waiting, then rows cascade in', async ({ page }) => {
  await page.route('**/v1/query', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    await new Promise((res) => setTimeout(res, 1200))
    return r.fulfill({ json: ANSWER })
  })
  await signIn(page)
  await page.locator('#question').fill(ANSWER.question)
  await page.locator('#question').press('Enter')
  const running = page.locator('.flow-border')
  await expect(running).toBeVisible()
  expect(await running.evaluate((el) => getComputedStyle(el).animationName)).toBe('flow-spin')
  await expect(page.getByRole('cell', { name: 'Dept 11', exact: true })).toBeVisible()
  await expect(running).toHaveCount(0)
  const rows = page.locator('tbody tr.row-in')
  await expect(rows).toHaveCount(12)
  // later rows start later: the cascade, not a block
  const delays = await rows.evaluateAll((els) => els.map((e) => getComputedStyle(e).animationDelay))
  expect(delays[0]).toBe('0s')
  expect(parseFloat(delays[11])).toBeGreaterThan(0.2)
})

test('admin numbers count up and settle on the exact values', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: /admin/i }).first().click()
  await expect(page.getByText('0.714', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('30/30 (direct_sql layer)', { exact: true })).toBeVisible()
})

test('reduced motion switches the motion off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/v1/query', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    await new Promise((res) => setTimeout(res, 800))
    return r.fulfill({ json: ANSWER })
  })
  await signIn(page)
  await page.locator('#question').fill('x')
  await page.locator('#question').press('Enter')
  expect(await page.locator('.flow-border').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  await expect(page.getByRole('cell', { name: 'Dept 0', exact: true })).toBeVisible()
  expect(await page.locator('tbody tr.row-in').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  expect(await drawsOver(page, 1000)).toBe(0) // orb drew one still frame, then stopped
})

test('every signed-in screen fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page)
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(await overflow()).toBe(0)
  for (const tab of [/history/i, /schema/i, /admin/i]) {
    await page.getByRole('button', { name: tab }).first().click()
    await page.waitForTimeout(1500)
    expect(await overflow()).toBe(0)
  }
  // Clipping must not hide content: the widest admin table still fits.
  const right = await page.locator('section', { has: page.locator('#google-title') }).locator('table').evaluate((t) => t.getBoundingClientRect().right)
  expect(right).toBeLessThanOrEqual(375)
})

// Regression: the splash used to restart on every App re-render, and under
// reduced motion it was hidden by CSS while still holding the app at opacity 0
// (a blank page that still accepted input).
const appOpacity = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.querySelector('main')!.parentElement!).opacity)

test('app is visible at once under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page)
  await expect.poll(() => appOpacity(page), { timeout: 1500 }).toBe('1')
})

test('intro splash plays once per session, not on every reload', async ({ page }) => {
  await signIn(page)
  await expect.poll(() => appOpacity(page), { timeout: 8000 }).toBe('1') // first visit: after the intro
  await page.reload()
  await expect(page.locator('#question')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.preloader')).toHaveCount(0)
  await expect.poll(() => appOpacity(page), { timeout: 1500 }).toBe('1')
})
