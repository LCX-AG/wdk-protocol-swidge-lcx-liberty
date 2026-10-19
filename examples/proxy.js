// Copyright 2026 LCX Liberty Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// A key-adding proxy for wallets that run on a user's device. The app talks to
// this server with no key; this server adds the key and forwards to the LCX
// Liberty Swap API. Only the six endpoints the module uses are forwarded.
//
//   LCX_API_KEY=lbk_live_... PORT=8080 node examples/proxy.js
//
// In the app:
//
//   new LcxLibertySwidgeProtocol(account, { baseUrl: 'https://swap.your-wallet.com' })
//
// Pin the key to this server's IP address in the LCX Liberty dashboard, and add
// your own authentication and rate limiting before you expose it.

import { createServer } from 'node:http'

const API = process.env.LCX_API_URL ?? 'https://swap-api.lcx.com'
const API_KEY = process.env.LCX_API_KEY
const PORT = Number(process.env.PORT ?? 8080)
const MAX_BODY = 64 * 1024

const INTENT = '0x[0-9a-fA-F]{64}'
const ROUTES = [
  ['GET', /^\/v1\/chains$/],
  ['GET', /^\/v1\/tokens$/],
  ['POST', /^\/v1\/quote$/],
  ['POST', /^\/v1\/build$/],
  ['GET', new RegExp(`^/v1/bridge/transfers/${INTENT}$`)],
  ['POST', new RegExp(`^/v1/bridge/transfers/${INTENT}/submitted$`)]
]

if (!API_KEY) {
  console.error('Set LCX_API_KEY.')
  process.exit(1)
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://proxy')
  if (!ROUTES.some(([method, path]) => method === req.method && path.test(url.pathname))) {
    return send(res, 404, { success: false, code: 'not_found', message: 'Not found.' })
  }

  let body
  if (req.method === 'POST') {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) return send(res, 413, { success: false, code: 'too_large', message: 'Request body too large.' })
      chunks.push(chunk)
    }
    body = Buffer.concat(chunks).toString('utf8')
  }

  try {
    const upstream = await fetch(API + url.pathname + url.search, {
      method: req.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body,
      signal: AbortSignal.timeout(30_000)
    })
    const headers = { 'Content-Type': 'application/json' }
    const retryAfter = upstream.headers.get('retry-after')
    if (retryAfter) headers['Retry-After'] = retryAfter
    res.writeHead(upstream.status, headers)
    res.end(await upstream.text())
  } catch {
    send(res, 502, { success: false, code: 'upstream_unreachable', message: 'The LCX Liberty API could not be reached.' })
  }
}).listen(PORT, () => console.log(`LCX Liberty proxy on :${PORT}`))

function send (res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}
