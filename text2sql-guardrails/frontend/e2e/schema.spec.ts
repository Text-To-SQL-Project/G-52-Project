import { test, expect, type Page } from '@playwright/test'

// Schema Explorer relationship graph, checked against the live /v1/schema.
// E2E_ADMIN_TOKEN: locally minted admin token (see speed.spec.ts).
const token = process.env.E2E_ADMIN_TOKEN
test.skip(!token, 'set E2E_ADMIN_TOKEN')
const API = process.env.E2E_API ?? 'http://localhost:8000'

async function openGraph(page: Page) {
  await page.addInitScript((t) => { localStorage.setItem('text2sql_auth_token', t); sessionStorage.setItem('preloader_seen', '1') }, token!)
  await page.goto('/')
  await page.getByRole('button', { name: /schema/i }).first().click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 })
}

test('one node per table, one edge per foreign key', async ({ page, request }) => {
  const schema = await (await request.get(`${API}/v1/schema`, { headers: { Authorization: `Bearer ${token}` } })).json()
  const fks = schema.tables.flatMap((t: { columns: { references?: string }[] }) => t.columns.filter((c) => c.references))
  await openGraph(page)
  await expect(page.locator('.react-flow__node')).toHaveCount(schema.tables.length)
  await expect(page.locator('.react-flow__edge')).toHaveCount(fks.length)
  // Power BI-style cardinality: one "*" and one "1" per relationship.
  await expect(page.locator('.erd-card', { hasText: '*' })).toHaveCount(fks.length)
})

test('clicking a table highlights exactly its relationships', async ({ page, request }) => {
  const schema = await (await request.get(`${API}/v1/schema`, { headers: { Authorization: `Bearer ${token}` } })).json()
  const near = new Set(['students'])
  for (const t of schema.tables) for (const c of t.columns) {
    const ref = c.references?.split('.')[0]
    if (t.name === 'students' && ref) near.add(ref)
    if (ref === 'students') near.add(t.name)
  }
  await openGraph(page)
  await page.locator('.react-flow__node[data-id="students"]').click()
  await expect(page.locator('.erd-focus')).toHaveCount(near.size)
  for (const id of near) await expect(page.locator(`.react-flow__node[data-id="${id}"] .erd-focus`)).toHaveCount(1)
  await expect(page.locator('.erd-dim')).toHaveCount(schema.tables.length - near.size)
  // Clicking empty canvas clears it.
  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(page.locator('.erd-dim')).toHaveCount(0)
})

test('search flies to a table and selects it', async ({ page }) => {
  await openGraph(page)
  await page.getByPlaceholder(/find a table or column/i).fill('placement_offers')
  const node = page.locator('.react-flow__node[data-id="placement_offers"]')
  await expect(node.locator('.erd-focus')).toHaveCount(1)
  await expect(node).toBeInViewport({ timeout: 5000 })
})

test('graph and list views switch', async ({ page }) => {
  await openGraph(page)
  await page.getByRole('tab', { name: /list/i }).click()
  await expect(page.locator('.react-flow')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /list/i })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /graph/i }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
})

test('minimap shows module colours', async ({ page }) => {
  await openGraph(page)
  const fill = await page.locator('.react-flow__minimap-node').first().evaluate((el) => getComputedStyle(el).fill)
  expect(fill).toMatch(/^rgb/)
  expect(fill).not.toBe('rgb(0, 0, 0)')
})
