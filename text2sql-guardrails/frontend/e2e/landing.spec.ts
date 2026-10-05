import { test, expect } from '@playwright/test'

// Signed-out routing: "/" landing <-> "/login" form, with real history.

test('landing leads to sign-in and back', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText("can't be talked into breaking it", { timeout: 30_000 })
  await expect(page.getByText('destructive queries executed')).toBeVisible()

  await page.getByRole('button', { name: 'Sign in to the workspace' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: /sign in$/i })).toBeVisible()

  await page.goBack() // browser Back returns to the landing page
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Sign in', exact: true }).click() // nav button
  await page.getByRole('button', { name: 'Back' }).click() // in-page Back link
  await expect(page).toHaveURL(/\/$/)
})

test('/login is directly linkable', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /sign in$/i })).toBeVisible({ timeout: 30_000 })
})

test('demo console settles to a full example under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const demo = page.getByRole('img', { name: /question becomes guarded SQL/ })
  await expect(demo).toContainText('How many students are there in each department?', { timeout: 30_000 })
  await expect(demo).toContainText('Computer Science')
})

test('signed-in visitors skip the landing page', async ({ page }) => {
  test.skip(!process.env.E2E_TOKEN, 'set E2E_TOKEN')
  await page.addInitScript((t) => localStorage.setItem('text2sql_auth_token', t), process.env.E2E_TOKEN!)
  await page.goto('/login')
  await expect(page.locator('#question')).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/$/) // normalised back to the app root
  await expect(page.getByText("can't be talked into breaking it")).toHaveCount(0)
})

test('no sideways scrolling on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
})
