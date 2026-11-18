import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer, loadConfigFromFile } from 'vite'

test('development proxy forwards API requests and keeps sessions on localhost', async (t) => {
  const requests = []
  const backend = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ url: req.url, method: req.method, headers: req.headers, body })
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Set-Cookie', 'connect.sid=test; Domain=backend.example; Path=/api; HttpOnly; Secure; SameSite=None')
    res.statusCode = req.url.endsWith('/login') ? 400 : 401
    res.end(JSON.stringify({ message: 'Test response' }))
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  t.after(() => new Promise((resolve) => backend.close(resolve)))

  const previousUrl = process.env.VITE_API_BASE_URL
  process.env.VITE_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/api/`
  t.after(() => {
    if (previousUrl === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = previousUrl
  })

  const root = fileURLToPath(new URL('../', import.meta.url))
  const vite = await createServer({ root, logLevel: 'silent', server: { port: 0, host: '127.0.0.1' } })
  t.after(() => vite.close())
  await vite.listen()
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  const response = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { message: 'Test response' })
  assert.equal(requests[0].url, '/api/login')
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].body, '{}')
  assert.equal(requests[0].headers.origin, undefined)
  const cookie = response.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, /Path=\/(?:;|$)/)
  assert.doesNotMatch(cookie, /Secure|Domain=/i)

  const session = await fetch(`${origin}/api/auth/me?check=1`, {
    headers: { Cookie: 'connect.sid=test' },
  })
  assert.equal(session.status, 401)
  assert.equal(requests[1].url, '/api/auth/me?check=1')
  assert.equal(requests[1].headers.cookie, 'connect.sid=test')

  for (const headers of [{ Origin: 'https://untrusted.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const blocked = await fetch(`${origin}/api/login`, { method: 'POST', headers })
    assert.equal(blocked.status, 404)
  }
  assert.equal(requests.length, 2)

  for (const configEnv of [
    { command: 'build', mode: 'production' },
    { command: 'serve', mode: 'production', isPreview: true },
  ]) {
    const config = await loadConfigFromFile(configEnv, undefined, root, 'silent')
    assert.equal(config.config.server?.proxy, undefined)
  }
})
