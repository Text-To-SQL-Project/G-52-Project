import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Export → chart as PNG, and chart + table as Word / PDF. Answer is canned
// (no LLM). Runs in dark mode: the export must still read on white paper.
// E2E_ADMIN_TOKEN: a locally minted admin token (see speed.spec.ts).
const token = process.env.E2E_ADMIN_TOKEN

const ANSWER = {
  query_id: 'q_chart', status: 'success', question: 'Which companies made the most accepted placement offers?', timestamp: new Date().toISOString(),
  sql: 'SELECT c.company_name, COUNT(*) AS accepted_offers_count FROM placement_offers o JOIN placement_companies c USING (company_id) GROUP BY 1 ORDER BY 2 DESC LIMIT 10;',
  explanation: 'Accepted offers per company.', tables_used: ['placement_offers'], columns_used: ['company_name'],
  results: { columns: ['company_name', 'accepted_offers_count'], rows: [['ZenDynamics LLP', 19], ['QuantumDynamics Pvt Ltd', 15], ['SysDynamics Inc', 14], ['ApexWorks Inc', 13]], row_count: 4, truncated: false },
  confidence: null, confidence_pending: false, execution_time_ms: 9, timings_ms: {},
  guardrail: { passed: true, blocked_reasons: [], injected_limit: null, checks_run: ['ast'] }, warnings: [],
}

test('chart exports as PNG, and with its table as Word and PDF', async ({ page }) => {
  test.skip(!token, 'set E2E_ADMIN_TOKEN')
  await page.addInitScript((t) => {
    localStorage.setItem('text2sql_auth_token', t)
    localStorage.setItem('theme', 'dark')
    sessionStorage.setItem('preloader_seen', '1')
  }, token!)
  await page.route('**/v1/query/stream', (r) => r.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ t: 'result', data: ANSWER }) + '\n' }))
  await page.goto('/')
  await page.locator('#question').fill(ANSWER.question)
  await page.locator('#question').press('Enter')

  // From the table view the menu offers to open the chart instead.
  await page.getByRole('button', { name: /^export$/i }).click()
  await page.getByRole('menuitem', { name: /open the chart/i }).click()
  await expect(page.locator('.recharts-wrapper > svg.recharts-surface')).toBeVisible()

  await page.getByRole('button', { name: /^export$/i }).click()
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /png image/i }).click()])
  const pngBytes = readFileSync(await png.path())
  expect(pngBytes.subarray(1, 4).toString()).toBe('PNG')
  if (process.env.OUT) await png.saveAs(`${process.env.OUT}/chart.png`)

  await page.getByRole('button', { name: /^export$/i }).click()
  const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /chart \+ table as word/i }).click()])
  const zip = readFileSync(await docx.path())
  expect(zip.includes(Buffer.from('word/media/chart.png'))).toBe(true)
  expect(zip.includes(Buffer.from('r:embed="rIdChart"'))).toBe(true)
  if (process.env.OUT) await docx.saveAs(`${process.env.OUT}/chart.docx`)

  // PDF: grab the print page before the dialog would open.
  await page.evaluate(() => { (window as unknown as { __doc?: string }).__doc = ''; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n instanceof HTMLIFrameElement && n.srcdoc) { (window as unknown as { __doc: string }).__doc = n.srcdoc; n.remove() } }))).observe(document.body, { childList: true }) })
  await page.getByRole('button', { name: /^export$/i }).click()
  await page.getByRole('menuitem', { name: /chart \+ table as pdf/i }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __doc: string }).__doc)).toContain('data:image/png')
  if (process.env.OUT) {
    const html = await page.evaluate(() => (window as unknown as { __doc: string }).__doc)
    const doc = await page.context().newPage()
    await doc.setContent(html)
    await doc.waitForTimeout(800)
    await doc.screenshot({ path: `${process.env.OUT}/chart-pdf-page.png`, fullPage: true })
  }
})
