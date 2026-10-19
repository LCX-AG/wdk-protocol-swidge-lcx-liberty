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

'use strict'

import { LcxLibertyApiError, LcxLibertyNoRouteError } from './errors.js'

export const DEFAULT_BASE_URL = 'https://swap-api.lcx.com'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 2
const MAX_RETRY_WAIT_MS = 10_000

// API error codes that mean "there is no way to do this trade right now", as
// opposed to a malformed request or an outage. They surface as
// LcxLibertyNoRouteError so a wallet can show "no route" rather than "error".
const NO_ROUTE_CODES = new Set([
  'no_route',
  'no_cross_route',
  'insufficient_liquidity',
  'route_not_executable',
  'pool_unreachable',
  'bridge_too_small',
  'bridge_too_large',
  'cross_chain_disabled'
])

/**
 * @typedef {Object} LcxLibertyApiClientOptions
 * @property {string} [apiKey] - Sent as `Authorization: Bearer <apiKey>`. Leave unset only when `baseUrl` is your own proxy that adds the key.
 * @property {string} [baseUrl] - API origin, without a trailing slash. Defaults to https://swap-api.lcx.com.
 * @property {number} [timeoutMs] - Per-request timeout. Defaults to 30 000 ms.
 * @property {number} [retries] - How many times a rate-limited (429) call is sent again. Defaults to 2.
 * @property {typeof fetch} [fetch] - A fetch implementation, for runtimes without a global one and for tests.
 */

/**
 * Thin HTTP client for the LCX Liberty Swap API. Every response is the API's
 * `{ success, data }` envelope; a `{ success: false, code, message }` body or a
 * non-2xx status becomes an {@link LcxLibertyApiError}.
 */
export default class LcxLibertyApiClient {
  /** @param {LcxLibertyApiClientOptions} [options] */
  constructor (options = {}) {
    this._apiKey = options.apiKey
    this._baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this._retries = options.retries ?? DEFAULT_RETRIES
    this._fetch = options.fetch ?? globalThis.fetch
  }

  /**
   * Sends a request. A 429 is retried after the `Retry-After` the API asks for: the
   * API refuses a rate-limited call before doing any work, so sending it again is
   * always safe. A wait longer than 10 s (a temporary block) is not retried.
   *
   * @param {'GET' | 'POST'} method
   * @param {string} path - Starts with `/`.
   * @param {{ query?: Record<string, string | number | boolean | undefined>, body?: unknown }} [options]
   * @returns {Promise<any>} The envelope's `data`.
   */
  async request (method, path, options = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this._send(method, path, options)
      } catch (error) {
        if (!(error instanceof LcxLibertyApiError) || error.status !== 429 || attempt >= this._retries) throw error
        const waitMs = (Number.isFinite(error.retryAfter) ? error.retryAfter : 1) * 1000
        if (waitMs > MAX_RETRY_WAIT_MS) throw error
        await new Promise(resolve => setTimeout(resolve, waitMs))
      }
    }
  }

  /** @private */
  async _send (method, path, { query, body } = {}) {
    if (typeof this._fetch !== 'function') {
      throw new LcxLibertyApiError('No fetch implementation is available; pass config.fetch.')
    }

    let url = this._baseUrl + path
    if (query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) params.set(key, String(value))
      }
      const qs = params.toString()
      if (qs) url += `?${qs}`
    }

    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/json' }
    if (this._apiKey) headers.Authorization = `Bearer ${this._apiKey}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const controller = typeof AbortController === 'function' ? new AbortController() : undefined
    const timer = controller ? setTimeout(() => controller.abort(), this._timeoutMs) : undefined

    let response
    try {
      response = await this._fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body, bigintReplacer),
        signal: controller?.signal
      })
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      throw new LcxLibertyApiError(
        aborted ? `LCX Liberty API request timed out after ${this._timeoutMs} ms: ${method} ${path}` : `LCX Liberty API request failed: ${method} ${path}`,
        { code: aborted ? 'TIMEOUT' : 'NETWORK', cause: error }
      )
    } finally {
      if (timer) clearTimeout(timer)
    }

    let payload
    try {
      payload = await response.json()
    } catch (error) {
      throw new LcxLibertyApiError(`LCX Liberty API returned a non-JSON response (HTTP ${response.status}) for ${method} ${path}.`, {
        code: 'BAD_RESPONSE', status: response.status, cause: error
      })
    }

    if (!response.ok || payload?.success === false) {
      const code = payload?.code ?? payload?.error ?? `HTTP_${response.status}`
      const message = payload?.message ?? `LCX Liberty API error (HTTP ${response.status}) for ${method} ${path}.`
      const retryAfterHeader = response.headers?.get?.('retry-after')
      const retryAfter = retryAfterHeader != null && retryAfterHeader !== '' ? Number(retryAfterHeader) : undefined
      const ErrorClass = NO_ROUTE_CODES.has(code) ? LcxLibertyNoRouteError : LcxLibertyApiError
      throw new ErrorClass(message, { code, status: response.status, retryAfter })
    }

    return payload?.data ?? payload
  }

  /**
   * `POST /v1/quote`. Same-chain when `toChainId` is absent or equal to `chainId`, cross-chain otherwise.
   *
   * @param {Record<string, unknown>} body
   */
  quote (body) {
    return this.request('POST', '/v1/quote', { body })
  }

  /**
   * `POST /v1/build`: turns a quote id into the transaction to sign.
   *
   * @param {{ quoteId: string, recipient: string, deadlineSecs?: number }} body
   */
  build (body) {
    return this.request('POST', '/v1/build', { body })
  }

  /** `GET /v1/chains`. */
  chains () {
    return this.request('GET', '/v1/chains')
  }

  /**
   * `GET /v1/tokens`.
   *
   * @param {{ chainId: number, search?: string, offset?: number, limit?: number }} query
   */
  tokens (query) {
    return this.request('GET', '/v1/tokens', { query })
  }

  /**
   * `GET /v1/bridge/transfers/{id}`: a cross-chain transfer by intent id (or transfer id).
   *
   * @param {string} id
   */
  transfer (id) {
    return this.request('GET', `/v1/bridge/transfers/${encodeURIComponent(id)}`)
  }

  /**
   * `POST /v1/bridge/transfers/{intentId}/submitted`: tells the tracker the source transaction is out.
   *
   * @param {string} intentId
   * @param {string} txHash
   */
  markSubmitted (intentId, txHash) {
    return this.request('POST', `/v1/bridge/transfers/${encodeURIComponent(intentId)}/submitted`, { body: { txHash } })
  }
}

/** JSON.stringify replacer that sends bigints as decimal strings. */
function bigintReplacer (_key, value) {
  return typeof value === 'bigint' ? value.toString() : value
}
