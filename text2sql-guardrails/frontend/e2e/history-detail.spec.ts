import { test, expect } from '@playwright/test'

// History → "View full result" re-opens a past answer from its stored
// snapshot. History endpoints are canned (no LLM, no DB rows needed).
// E2E_ADMIN_TOKEN: a locally minted admin token (see speed.spec.ts).
const token = process.env.E2E_ADMIN_TOKEN

const SNAPSHOT = {
  query_id: 'q_hist', status: 'success', question: 'Which departments have the most students?', timestamp: '2026-10-14T09:30:00Z',
  sql: 'SELECT d.department_name, COUNT(*) AS students FROM students s JOIN departments d USING (department_id) GROUP BY 1 ORDER BY 2 DESC;',
  explanation: 'Counts students per department.', tables_used: ['students', 'departments'], columns_used: ['department_name'],
  results: { columns: ['department_name', 'students'], rows: [['Civil Engineering', 375], ['Mechanical Engineering', 330]], row_count: 2, truncated: false },
  confidence: { score: 0.9, label: 'High', calibrated: false, capped: false, signals: [
    { key: 'schema_alignment', label: 'Schema Alignment', score: 1, status: 'pass', detail: 'ok', weight: 0.5 },
    { key: 'sql_validity', label: 'SQL Validity', score: 0.8, status: 'pass', detail: 'ok', weight: 0.5 },
  ] },
  confidence_pending: false, guardrail: { passed: true, blocked_reasons: [], checks_run: [] }, warnings: [],
}
const ITEM = {
  query_id: 'q_hist', question: SNAPSHOT.question, sql_preview: 'SELECT d.department_name, COUNT(*) …', status: 'success',
  confidence_score: 0.9, row_count: 2, timestamp: SNAPSHOT.timestamp, has_detail: true,
}

test('a past answer re-opens with its SQL, confidence and rows', async ({ page }) => {
  test.skip(!token, 'set E2E_ADMIN_TOKEN')
  await page.addInitScript((t) => { localStorage.setItem('text2sql_auth_token', t); sessionStorage.setItem('preloader_seen', '1') }, token!)
  await page.route('**/v1/history?**', (r) => r.fulfill({ json: { items: [ITEM, { ...ITEM, query_id: 'q_old', question: 'Older blocked one', status: 'blocked', has_detail: false }], total: 2 } }))
  await page.route('**/v1/history/q_hist', (r) => r.fulfill({ json: SNAPSHOT }))

  await page.goto('/')
  await page.getByRole('button', { name: /history/i }).first().click()
  // First paint of the lazily loaded History screen can be slow under parallel load.
  await expect(page.getByRole('button', { name: /view full result/i })).toHaveCount(1, { timeout: 20_000 }) // only answers with a snapshot
  await page.getByRole('button', { name: /view full result/i }).click()

  await expect(page.getByText('Civil Engineering')).toBeVisible()
  await expect(page.getByText('High Confidence')).toBeVisible()
  await expect(page.getByRole('button', { name: /export/i })).toBeVisible()
  await page.getByRole('button', { name: /back to history/i }).click()
  await expect(page.getByText('Older blocked one')).toBeVisible()
})
