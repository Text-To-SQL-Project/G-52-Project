import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Every screen in both themes: WCAG AA colour contrast (axe) + a screenshot.
// The workspace answer is canned (no LLM calls). E2E_ADMIN_TOKEN: a locally
// minted admin session token (see speed.spec.ts).
const token = process.env.E2E_ADMIN_TOKEN

const ANSWER = {
  query_id: 'q_theme', status: 'success', question: 'How many students are there in each department?',
  timestamp: new Date().toISOString(),
  sql: 'SELECT d.department_name, COUNT(*) AS students\nFROM students s JOIN departments d USING (department_id)\nGROUP BY d.department_name\nORDER BY students DESC\nLIMIT 1000;',
  explanation: 'Counts students per department.', tables_used: ['students', 'departments'], columns_used: ['department_name'],
  results: { columns: ['department_name', 'students'], rows: [['Computer Science', 412], ['Mechanical', 298], ['Civil', 201]], row_count: 3, truncated: false },
  confidence: { score: 0.86, label: 'High', calibrated: true, signals: [
    { key: 'sql_validity', label: 'SQL Validity', score: 1, status: 'pass', detail: 'ok' },
    { key: 'schema_alignment', label: 'Schema Alignment', score: 0.92, status: 'pass', detail: 'ok' },
    { key: 'back_translation_match', label: 'Back-translation Match', score: 0.61, status: 'warn', detail: 'close' },
    { key: 'result_sanity', label: 'Result Sanity', score: 0.3, status: 'fail', detail: 'odd' },
  ] },
  confidence_pending: false, execution_time_ms: 31,
  timings_ms: { generation: 1620, guardrails: 4, pre_checks: 3, execution: 31, post_checks: 4, history: 6, total: 1668 },
  guardrail: { passed: true, blocked_reasons: [], injected_limit: 1000, checks_run: ['ast'] }, warnings: [],
}

async function contrast(page: Page) {
  const r = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
  return r.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')} :: ${n.any[0]?.message ?? ''}`))
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.skip(!token, 'set E2E_ADMIN_TOKEN')
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' }) // settle animations before auditing
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
    })

    test('login', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('button', { name: /sign in$/i })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.screenshot({ path: test.info().outputPath(`${theme}-login.png`) })
      expect(await contrast(page)).toEqual([])
    })

    test('signed-in screens', async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('text2sql_auth_token', t), token!)
      await page.route('**/v1/query', (r) => r.request().method() === 'POST' ? r.fulfill({ json: ANSWER }) : r.fallback())
      await page.goto('/')
      const q = page.locator('#question')
      await expect(q).toBeVisible({ timeout: 30_000 })
      await q.fill(ANSWER.question)
      await q.press('Enter')
      await expect(page.getByText('Computer Science')).toBeVisible()
      await page.screenshot({ path: test.info().outputPath(`${theme}-workspace.png`), fullPage: true })
      const found: Record<string, string[]> = { workspace: await contrast(page) }

      for (const [name, nav, ready] of [
        ['history', /history/i, /history/i],
        ['schema', /schema/i, /\d+ tables · \d+ columns/],
        ['admin', /admin/i, /AI key pool/i],
      ] as const) {
        await page.getByRole('button', { name: nav }).first().click()
        // Scoped to <main>'s visible screen: the workspace stays mounted (hidden) behind it.
        await expect(page.locator('main').getByText(ready).locator('visible=true').first()).toBeVisible({ timeout: 30_000 })
        await page.waitForTimeout(800)
        await page.screenshot({ path: test.info().outputPath(`${theme}-${name}.png`), fullPage: true })
        found[name] = await contrast(page)
      }
      expect(found).toEqual({ workspace: [], history: [], schema: [], admin: [] })
    })
  })
}
