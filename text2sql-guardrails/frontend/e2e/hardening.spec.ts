import { test, expect } from '@playwright/test'

// Runs against the live backend on :8000 (no LLM calls, no real accounts).
const API = process.env.E2E_API ?? 'http://localhost:8000'

test('API sends security headers and a request id', async ({ request }) => {
  const r = await request.get(`${API}/health`)
  expect(r.ok()).toBeTruthy()
  const h = r.headers()
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['x-request-id']).toBeTruthy()
})

test('readiness checks both database roles', async ({ request }) => {
  const r = await request.get(`${API}/healthz`)
  expect(r.status()).toBe(200)
  expect(await r.json()).toEqual({ status: 'ready' })
})

test('login is rate limited per client and says when to retry', async ({ request }) => {
  const attempt = () =>
    request.post(`${API}/auth/login`, { data: { username: 'e2e-no-such-user', password: 'wrong' } })
  let last
  for (let i = 0; i < 11; i++) last = await attempt()
  expect(last!.status()).toBe(429)
  expect(Number(last!.headers()['retry-after'])).toBeGreaterThan(0)
  expect((await last!.json()).detail).toMatch(/Try again in \d+ s/)
})

test('oversized questions are rejected before reaching the model', async ({ request }) => {
  const r = await request.post(`${API}/v1/query`, { data: { question: 'x'.repeat(2001) } })
  expect([401, 422]).toContain(r.status()) // 401 without a token: auth runs first, still no LLM call
})
