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

// Every error extends one of WDK's own error classes, so a wallet can handle
// a failure from this module exactly as it handles one from any other swidge
// provider (catch ValueError, ProviderError, MaximumFeeExceededError, ...),
// and still branch on our `code` when it wants the detail.

import {
  AccountRequiredError,
  MaximumFeeExceededError,
  NoSuchElementError,
  ProviderError,
  SwidgeError,
  SwidgeErrorReason,
  ValueError
} from '@tetherto/wdk-wallet/protocols'

/** The options or configuration passed to the module are not valid. */
export class LcxLibertyValidationError extends ValueError {
  /** @param {string} message */
  constructor (message) {
    super(message)
    this.name = 'LcxLibertyValidationError'
  }
}

/** The request asked for something LCX Liberty DEX does not offer, for example an exact-output swap. */
export class LcxLibertyUnsupportedError extends ValueError {
  /** @param {string} message */
  constructor (message) {
    super(message)
    this.name = 'LcxLibertyUnsupportedError'
  }
}

/** The operation needs a wallet account that can sign and send transactions, and none was bound. */
export class LcxLibertyAccountRequiredError extends AccountRequiredError {
  constructor () {
    super('This operation needs a wallet account that can sign and send transactions.')
    this.name = 'LcxLibertyAccountRequiredError'
  }
}

/**
 * The LCX Liberty API answered with an error, or could not be reached.
 * `code` (also `reason`) is the API's own error code, `status` the HTTP status.
 */
export class LcxLibertyApiError extends ProviderError {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, retryAfter?: number, cause?: unknown }} [options]
   */
  constructor (message, options = {}) {
    super(message, { reason: options.code, cause: options.cause })
    this.name = 'LcxLibertyApiError'
    /** @type {string | undefined} */
    this.code = options.code
    /** @type {number | undefined} */
    this.status = options.status
    /** @type {number | undefined} Seconds the API asked the caller to wait before retrying (429 responses). */
    this.retryAfter = options.retryAfter
  }
}

/** No route exists right now for the requested pair, amount or chains. */
export class LcxLibertyNoRouteError extends LcxLibertyApiError {
  constructor (message, options = {}) {
    super(message, options)
    this.name = 'LcxLibertyNoRouteError'
  }
}

/** A configured fee cap would be exceeded, or could not be evaluated (caps fail closed). */
export class LcxLibertyFeeLimitExceededError extends MaximumFeeExceededError {
  /**
   * @param {'network' | 'protocol'} kind
   * @param {number | null} actualBps - The fee in basis points of the input value, or null when it could not be evaluated.
   * @param {number} maxBps
   */
  constructor (kind, actualBps, maxBps) {
    super(actualBps == null
      ? `The ${kind} fee could not be measured against the configured cap of ${maxBps} bps, so the swidge was refused.`
      : `The ${kind} fee of ${actualBps.toFixed(2)} bps exceeds the configured cap of ${maxBps} bps.`)
    this.name = 'LcxLibertyFeeLimitExceededError'
    this.kind = kind
    this.actualBps = actualBps
    this.maxBps = maxBps
  }
}

/** The route's guaranteed output is below the caller's `minAmountOut`. */
export class LcxLibertyMinAmountOutError extends SwidgeError {
  /**
   * @param {bigint} guaranteed
   * @param {bigint} required
   */
  constructor (guaranteed, required) {
    super(`The route guarantees at least ${guaranteed}, below the required minAmountOut of ${required}.`,
      { reason: SwidgeErrorReason.COULD_NOT_MET_THRESHOLD })
    this.name = 'LcxLibertyMinAmountOutError'
    this.guaranteed = guaranteed
    this.required = required
  }
}

/** A transaction this module sent (an approval) was mined but reverted. */
export class LcxLibertyTransactionRevertedError extends SwidgeError {
  /** @param {string} hash */
  constructor (hash) {
    super(`Transaction ${hash} reverted.`, { reason: 'TRANSACTION_REVERTED' })
    this.name = 'LcxLibertyTransactionRevertedError'
    this.hash = hash
  }
}

/** A transaction this module sent (an approval) did not confirm in time. */
export class LcxLibertyTimeoutError extends SwidgeError {
  /** @param {string} hash */
  constructor (hash) {
    super(`Timed out waiting for transaction ${hash} to confirm.`, { reason: 'TRANSACTION_TIMEOUT' })
    this.name = 'LcxLibertyTimeoutError'
    this.hash = hash
  }
}

/** No cross-chain transfer exists for the given swidge id. */
export class LcxLibertyUnknownSwidgeError extends NoSuchElementError {
  /** @param {string} id */
  constructor (id) {
    super(`No swidge found for id '${id}'.`)
    this.name = 'LcxLibertyUnknownSwidgeError'
    this.id = id
  }
}
