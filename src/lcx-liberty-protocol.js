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

import { InvalidTokenError, ProviderRequiredError, SwidgeProtocol } from '@tetherto/wdk-wallet/protocols'

import LcxLibertyApiClient, { DEFAULT_BASE_URL } from './api-client.js'
import {
  LcxLibertyAccountRequiredError,
  LcxLibertyApiError,
  LcxLibertyFeeLimitExceededError,
  LcxLibertyMinAmountOutError,
  LcxLibertyTimeoutError,
  LcxLibertyTransactionRevertedError,
  LcxLibertyUnknownSwidgeError,
  LcxLibertyUnsupportedError,
  LcxLibertyValidationError
} from './errors.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFee} SwidgeFee */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatus} SwidgeStatus */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeTransaction} SwidgeTransaction */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions} SwidgeStatusOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */

/**
 * @typedef {Object} LcxLibertySwidgeProtocolConfig
 * @property {string} [apiKey] - LCX Liberty Swap API key (`lbk_live_...`), sent as `Authorization: Bearer`. Required unless `baseUrl` points at your own proxy that adds the key. Keep it server-side: see the README.
 * @property {string} [baseUrl] - API origin without a trailing slash. Defaults to `https://swap-api.lcx.com`.
 * @property {string} [integrator] - Your registered integrator slug or fee-recipient address, for attribution (same-chain swaps).
 * @property {number} [chainId] - EVM chain id of the bound account. When omitted it is read from `provider`.
 * @property {string | { request: Function }} [provider] - JSON-RPC URL or EIP-1193 provider. Defaults to the bound account's own provider.
 * @property {number} [defaultSlippage] - Default slippage as a decimal (0.005 = 0.5%). When omitted the API default (0.5%) applies.
 * @property {number} [deadlineSecs] - Validity window of a same-chain swap transaction. API default 300, maximum 3600.
 * @property {number} [tokensPerChain] - How many tokens `getSupportedTokens` returns per chain (1-200). Defaults to 200.
 * @property {number} [timeoutMs] - Per-request API timeout. Defaults to 30 000 ms.
 * @property {number} [retries] - How many times a rate-limited (429) API call is sent again, after the wait the API asks for (at most 10 s). Defaults to 2.
 * @property {number} [receiptTimeoutMs] - How long `swidge` waits for an approval to confirm. Defaults to 180 000 ms.
 * @property {number} [receiptPollMs] - Poll interval while waiting for an approval. Defaults to 2 000 ms.
 * @property {number} [approvalSettleMs] - Pause after an approval confirms, before the swap is signed. Defaults to 500 ms.
 * @property {typeof fetch} [fetch] - A fetch implementation, for runtimes without a global one and for tests.
 * @property {number | bigint} [maxNetworkFeeBps] - Maximum network fee in basis points of the input value. Fails closed.
 * @property {number | bigint} [maxProtocolFeeBps] - Maximum protocol fee (bridge fees on cross-chain routes) in basis points of the input. Fails closed.
 */

const NATIVE = '0x0000000000000000000000000000000000000000'
const NATIVE_ALIASES = new Set(['', 'native', NATIVE, '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'])
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const TX_HASH = /^0x[0-9a-fA-F]{64}$/
const USDT_ETHEREUM = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const XCHAIN_PREFIX = 'xchain:'
const MAX_SLIPPAGE = 0.2 // the API refuses more than 2000 bps
const APPROVAL_SETTLE_MS = 500

// WDK-style chain names, plus the API's own chain keys, mapped to chain ids.
// Anything else is resolved against `/v1/chains`.
const CHAIN_ALIASES = {
  ethereum: 1,
  mainnet: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  op: 10,
  polygon: 137,
  bsc: 56,
  bnb: 56,
  avalanche: 43114,
  avax: 43114,
  robinhood: 4663
}

// The cross-chain tracker's states, mapped to WDK's swidge statuses.
// NEEDS_ATTENTION is not final (the operator resolves it), so it stays pending.
// DST_FALLBACK delivered something; it is 'partial' when the token delivered is not the one asked for.
/** @type {Record<string, SwidgeStatus>} */
const TRANSFER_STATUS = {
  UNKNOWN: 'pending',
  QUOTED: 'pending',
  SUBMITTED: 'pending',
  SRC_CONFIRMED: 'pending',
  BRIDGE_PENDING: 'pending',
  BRIDGE_COMPLETE: 'pending',
  NEEDS_ATTENTION: 'pending',
  DST_EXECUTED: 'completed',
  DONE: 'completed',
  REFUND_PENDING: 'refund-pending',
  REFUND_CLAIMABLE: 'action-required',
  AWAITING_ACTION: 'action-required',
  REFUNDED: 'refunded',
  EXPIRED: 'expired'
}

/**
 * WDK swidge protocol for LCX Liberty DEX.
 *
 * Same-chain swaps are routed across every venue LCX Liberty DEX indexes; cross-chain
 * routes swap and bridge in one source transaction. LCX Liberty DEX takes no protocol
 * fee on the swap. Exact-input only.
 *
 * @extends {SwidgeProtocol}
 */
export default class LcxLibertySwidgeProtocol extends SwidgeProtocol {
  /**
   * Creates the protocol without a wallet account: chain and token discovery, and
   * quotes when `config.chainId` (or `config.provider`) is set.
   *
   * @overload
   * @param {undefined} [account]
   * @param {LcxLibertySwidgeProtocolConfig} [config]
   */

  /**
   * Creates a read-only protocol: quotes, discovery and status.
   *
   * @overload
   * @param {IWalletAccountReadOnly} account
   * @param {LcxLibertySwidgeProtocolConfig} [config]
   */

  /**
   * Creates a protocol that can execute swidges with the given account.
   *
   * @overload
   * @param {IWalletAccount} account
   * @param {LcxLibertySwidgeProtocolConfig} [config]
   */
  constructor (account, config = {}) {
    super(account, config)

    const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    if (!config.apiKey && baseUrl === DEFAULT_BASE_URL) {
      throw new LcxLibertyValidationError(
        'config.apiKey is required for https://swap-api.lcx.com. Create a key at https://dex.lcx.com/dashboard, ' +
        'or set config.baseUrl to your own proxy that adds it.'
      )
    }
    if (config.defaultSlippage != null) slippageToBps(config.defaultSlippage)

    /** @protected @type {LcxLibertySwidgeProtocolConfig} */
    this._config = config

    /** @protected */
    this._api = new LcxLibertyApiClient({ apiKey: config.apiKey, baseUrl, timeoutMs: config.timeoutMs, retries: config.retries, fetch: config.fetch })

    /** @private */
    this._provider = config.provider ?? account?._config?.provider

    /** @private @type {number | undefined} */
    this._chainId = config.chainId != null ? Number(config.chainId) : undefined

    /** @private @type {typeof fetch} */
    this._fetch = config.fetch ?? globalThis.fetch

    /** @private @type {Array<any> | undefined} */
    this._chains = undefined
  }

  /**
   * Quotes a same-chain swap or a cross-chain swap-and-bridge. Non-binding.
   *
   * A cross-chain quote needs a recipient: the bound account's address, or `options.recipient`.
   *
   * @param {SwidgeOptions} options
   * @returns {Promise<SwidgeQuote>}
   */
  async quoteSwidge (options) {
    const plan = await this._plan(options, false)
    const quote = await this._quote(plan)
    return this._toSwidgeQuote(plan, quote)
  }

  /**
   * Executes a swidge: quotes, enforces `minAmountOut` and the fee caps, builds the
   * transaction, approves the input token if the current allowance is short, and sends.
   *
   * Cross-chain swidges deliver to the sending wallet on the destination chain.
   *
   * @param {SwidgeOptions} options
   * @param {SwidgeProtocolConfig & { deadlineSecs?: number }} [config] - Per-call fee caps.
   * @returns {Promise<SwidgeResult>}
   */
  async swidge (options, config) {
    if (!this._account || typeof this._account.sendTransaction !== 'function') {
      throw new LcxLibertyAccountRequiredError()
    }

    const plan = await this._plan(options, true)
    const quote = await this._quote(plan)
    const summary = this._toSwidgeQuote(plan, quote)

    if (plan.minAmountOut != null && summary.toTokenAmountMin < plan.minAmountOut) {
      throw new LcxLibertyMinAmountOutError(summary.toTokenAmountMin, plan.minAmountOut)
    }
    this._checkFeeCaps(plan, quote, config)

    return plan.crossChain
      ? this._executeCrossChain(plan, quote, summary)
      : this._executeSameChain(plan, quote, summary, config)
  }

  /**
   * Returns the status of a swidge started by {@link swidge}.
   *
   * - Cross-chain ids (`xchain:<intentId>`) are read from the LCX Liberty transfer tracker.
   * - Same-chain ids (`<chainId>:<txHash>`, or a bare hash with `options.fromChain`) are read
   *   from the transaction receipt, through the bound account or `config.provider`.
   *
   * @param {string} id
   * @param {SwidgeStatusOptions} [options]
   * @returns {Promise<SwidgeStatusResult>}
   */
  async getSwidgeStatus (id, options) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new LcxLibertyValidationError('A swidge id is required.')
    }

    if (id.startsWith(XCHAIN_PREFIX)) {
      const intentId = id.slice(XCHAIN_PREFIX.length)
      if (!TX_HASH.test(intentId)) throw new LcxLibertyValidationError(`Invalid cross-chain swidge id '${id}'.`)
      let transfer
      try {
        transfer = await this._api.transfer(intentId)
      } catch (error) {
        if (error instanceof LcxLibertyApiError && error.status === 404) throw new LcxLibertyUnknownSwidgeError(id)
        throw error
      }
      return transferStatus(transfer)
    }

    const separator = id.indexOf(':')
    const chainId = separator === -1 ? Number(options?.fromChain ?? this._chainId) : Number(id.slice(0, separator))
    const hash = separator === -1 ? id : id.slice(separator + 1)
    if (!TX_HASH.test(hash)) throw new LcxLibertyValidationError(`Invalid transaction hash in swidge id '${id}'.`)
    if (!Number.isFinite(chainId)) {
      throw new LcxLibertyValidationError("Pass an id in the '<chainId>:<txHash>' form, or options.fromChain.")
    }

    const connected = await this._getChainId()
    if (connected !== chainId) {
      throw new LcxLibertyValidationError(
        `This swidge ran on chain ${chainId}; read its status with an account or provider on that chain (connected: ${connected}).`
      )
    }

    /** @type {SwidgeTransaction[]} */
    const transactions = [{ hash, chain: chainId, type: 'source' }]
    const receipt = await this._receipt(hash)
    if (receipt) return { status: receiptSucceeded(receipt) ? 'completed' : 'failed', transactions }

    const tx = await this._transaction(hash)
    if (tx === null) throw new LcxLibertyUnknownSwidgeError(id)
    return { status: 'pending', transactions }
  }

  /**
   * The EVM chains LCX Liberty DEX currently serves.
   *
   * @returns {Promise<SwidgeSupportedChain[]>}
   */
  async getSupportedChains () {
    const chains = await this._loadChains()
    return chains
      .filter(chain => chain.routerDeployed !== false)
      .map(chain => ({ id: chain.chainId, name: chain.name, type: 'evm', nativeToken: chain.nativeSymbol }))
  }

  /**
   * Tokens LCX Liberty DEX can route, per chain. With `fromChain` (or `toChain`) only that
   * chain is listed; otherwise every supported chain. Each chain returns up to
   * `config.tokensPerChain` tokens (default 200), in the API's own order; any token
   * address can still be quoted directly.
   *
   * @param {SwidgeSupportedTokensOptions} [options]
   * @returns {Promise<SwidgeSupportedToken[]>}
   */
  async getSupportedTokens (options = {}) {
    const scope = options.fromChain ?? options.toChain
    const chainIds = scope != null
      ? [await this._resolveChain(scope)]
      : (await this.getSupportedChains()).map(chain => Number(chain.id))
    const limit = Math.min(Math.max(Number(this._config.tokensPerChain ?? 200), 1), 200)

    // One chain at a time: a token list is an expensive call, and twelve at once
    // would spend a Free plan's whole per-second allowance.
    const pages = []
    for (const chainId of chainIds) pages.push(await this._api.tokens({ chainId, limit }))
    return pages.flatMap(page => (page?.tokens ?? []).map(row => ({
      token: row.address ?? row.id,
      chain: row.chainId,
      symbol: row.symbol,
      decimals: row.decimals,
      address: row.address ?? row.id,
      name: row.name
    })))
  }

  // ---------------------------------------------------------------------------
  // Planning and quoting
  // ---------------------------------------------------------------------------

  /** @private */
  async _plan (options, forExecution) {
    if (options == null || typeof options !== 'object') throw new LcxLibertyValidationError('Swidge options are required.')
    if (options.toTokenAmount != null) {
      throw new LcxLibertyUnsupportedError('LCX Liberty DEX quotes exact-input only: pass fromTokenAmount, not toTokenAmount.')
    }
    if (options.fromTokenAmount == null) throw new LcxLibertyValidationError('fromTokenAmount is required.')

    let amountIn
    try {
      amountIn = BigInt(options.fromTokenAmount)
    } catch {
      throw new LcxLibertyValidationError('fromTokenAmount must be an integer amount in base units.')
    }
    if (amountIn <= 0n) throw new LcxLibertyValidationError('fromTokenAmount must be greater than zero.')

    const tokenIn = normalizeToken(options.fromToken, 'fromToken')
    const tokenOut = normalizeToken(options.toToken, 'toToken')

    const fromChainId = await this._getChainId()
    const toChainId = options.toChain == null ? fromChainId : await this._resolveChain(options.toChain)
    const crossChain = toChainId !== fromChainId
    if (!crossChain && tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      throw new LcxLibertyValidationError('fromToken and toToken are the same token on the same chain.')
    }

    if (options.recipient != null && !ADDRESS.test(options.recipient)) {
      throw new LcxLibertyValidationError(`recipient '${options.recipient}' is not an EVM address.`)
    }

    const sender = await this._address(forExecution)
    const recipient = options.recipient ?? sender

    if (crossChain && recipient == null) {
      throw new LcxLibertyValidationError('A cross-chain quote needs a recipient: bind a wallet account or pass options.recipient.')
    }
    if (crossChain && forExecution && recipient.toLowerCase() !== sender.toLowerCase()) {
      throw new LcxLibertyUnsupportedError('A cross-chain swidge delivers to the sending wallet: recipient must be the account address.')
    }

    const slippage = options.slippage ?? this._config.defaultSlippage
    return {
      fromChainId,
      toChainId,
      crossChain,
      tokenIn,
      tokenOut,
      amountIn,
      slippageBps: slippage == null ? undefined : slippageToBps(slippage),
      sender,
      recipient,
      minAmountOut: options.minAmountOut == null ? undefined : BigInt(options.minAmountOut)
    }
  }

  /** @private */
  async _quote (plan) {
    const body = {
      chainId: plan.fromChainId,
      tokenIn: plan.tokenIn,
      tokenOut: plan.tokenOut,
      amountIn: plan.amountIn.toString()
    }
    if (plan.slippageBps != null) body.slippageBps = plan.slippageBps
    if (plan.crossChain) {
      body.toChainId = plan.toChainId
      body.recipient = plan.recipient
    } else if (this._config.integrator) {
      body.integrator = this._config.integrator
    }
    const data = await this._api.quote(body)
    return data?.quote ?? data
  }

  /**
   * @private
   * @returns {SwidgeQuote}
   */
  _toSwidgeQuote (plan, quote) {
    if (plan.crossChain) {
      return {
        fromTokenAmount: plan.amountIn,
        toTokenAmount: BigInt(quote.endToEndOut),
        toTokenAmountMin: BigInt(quote.endToEndMinOut),
        fees: crossChainFees(plan, quote),
        estimatedDuration: quote.etaSec ?? undefined,
        expiry: quote.expiresAt ?? undefined,
        priceImpact: undefined
      }
    }
    return {
      fromTokenAmount: plan.amountIn,
      toTokenAmount: BigInt(quote.output.amount),
      toTokenAmountMin: BigInt(quote.output.minimumAmount),
      fees: sameChainFees(plan, quote),
      estimatedDuration: undefined,
      expiry: quote.expiresAt ?? undefined,
      priceImpact: quote.priceImpactPct == null ? undefined : quote.priceImpactPct / 100
    }
  }

  /**
   * Enforces maxNetworkFeeBps / maxProtocolFeeBps. Both fail closed: a cap that is
   * configured but cannot be measured refuses the swidge.
   *
   * - Network fee: the quote's USD gas estimate against the USD value of the input.
   * - Protocol fee: LCX Liberty DEX charges none on the swap, so on a same-chain route
   *   it is zero (an integrator's own fee is reported as 'affiliate', not capped here);
   *   on a cross-chain route it is the bridge's fee against the amount bridged.
   *
   * @private
   */
  _checkFeeCaps (plan, quote, callConfig) {
    const maxNetwork = callConfig?.maxNetworkFeeBps ?? this._config.maxNetworkFeeBps
    const maxProtocol = callConfig?.maxProtocolFeeBps ?? this._config.maxProtocolFeeBps

    if (maxNetwork != null) {
      const bps = plan.crossChain ? crossChainNetworkBps(quote) : sameChainNetworkBps(quote)
      if (bps == null || bps > Number(maxNetwork)) {
        throw new LcxLibertyFeeLimitExceededError('network', bps, Number(maxNetwork))
      }
    }

    if (maxProtocol != null && plan.crossChain) {
      const bps = bridgeFeeBps(quote)
      if (bps == null || bps > Number(maxProtocol)) {
        throw new LcxLibertyFeeLimitExceededError('protocol', bps, Number(maxProtocol))
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /** @private */
  async _executeSameChain (plan, quote, summary, callConfig) {
    const deadlineSecs = callConfig?.deadlineSecs ?? this._config.deadlineSecs
    const built = await this._api.build({
      quoteId: quote.quoteId,
      recipient: plan.recipient,
      ...(deadlineSecs != null ? { deadlineSecs } : {})
    })
    if (!built?.swap) {
      throw new LcxLibertyApiError(`LCX Liberty DEX has no router on chain ${plan.fromChainId} yet.`, { code: 'router_not_deployed' })
    }

    /** @type {SwidgeTransaction[]} */
    const transactions = []
    if (!isNative(plan.tokenIn)) {
      await this._ensureAllowance(plan.tokenIn, built.swap.to, plan.amountIn, plan.fromChainId, transactions)
    }

    const hash = await this._send(built.swap)
    transactions.push({ hash, chain: plan.fromChainId, type: 'source' })

    return {
      id: `${plan.fromChainId}:${hash}`,
      hash,
      fees: summary.fees,
      transactions,
      fromTokenAmount: plan.amountIn,
      toTokenAmount: BigInt(built.amountOut ?? quote.output.amount),
      toTokenAmountMin: BigInt(built.minAmountOut ?? quote.output.minimumAmount)
    }
  }

  /** @private */
  async _executeCrossChain (plan, quote, summary) {
    const built = await this._api.build({ quoteId: quote.quoteId, recipient: plan.recipient })
    const request = built?.transactionRequest
    if (!request?.to || !request?.data) {
      throw new LcxLibertyApiError('The cross-chain build returned no transaction to send.', { code: 'bad_build' })
    }
    if (request.chainId != null && Number(request.chainId) !== plan.fromChainId) {
      throw new LcxLibertyApiError(
        `The cross-chain build targets chain ${request.chainId}, but the account is on chain ${plan.fromChainId}.`,
        { code: 'chain_mismatch' }
      )
    }

    /** @type {SwidgeTransaction[]} */
    const transactions = []
    if (built.approval && !isNative(plan.tokenIn)) {
      await this._ensureAllowance(plan.tokenIn, built.approval.target, BigInt(built.approval.amount), plan.fromChainId, transactions)
    }

    const hash = await this._send(request)
    transactions.push({ hash, chain: plan.fromChainId, type: 'source' })

    // Lets the tracker move the transfer to SUBMITTED at once. It binds to the chain
    // on its own anyway, so a failure here changes nothing for the user.
    try {
      await this._api.markSubmitted(built.intentId, hash)
    } catch {}

    return {
      id: `${XCHAIN_PREFIX}${built.intentId}`,
      hash,
      fees: summary.fees,
      transactions,
      fromTokenAmount: plan.amountIn,
      toTokenAmount: BigInt(built.endToEndOut ?? quote.endToEndOut),
      toTokenAmountMin: BigInt(built.endToEndMinOut ?? quote.endToEndMinOut)
    }
  }

  /**
   * Approves `amount` of `token` to `spender` unless the current allowance already covers it.
   * USDT on Ethereum refuses a non-zero to non-zero change, so it is reset to zero first.
   *
   * @private
   */
  async _ensureAllowance (token, spender, amount, chainId, transactions) {
    let current
    if (typeof this._account.getAllowance === 'function') {
      current = BigInt(await this._account.getAllowance(token, spender))
      if (current >= amount) return
    }
    if (typeof this._account.approve !== 'function') {
      throw new LcxLibertyValidationError('The wallet account cannot approve tokens, and the input token needs an approval.')
    }

    if (chainId === 1 && token.toLowerCase() === USDT_ETHEREUM && current != null && current > 0n) {
      const reset = await this._account.approve({ token, spender, amount: 0n })
      transactions.push({ hash: reset.hash, chain: chainId, type: 'approval' })
      await this._waitForReceipt(reset.hash)
      await new Promise(resolve => setTimeout(resolve, this._config.approvalSettleMs ?? APPROVAL_SETTLE_MS))
    }

    const approval = await this._account.approve({ token, spender, amount })
    transactions.push({ hash: approval.hash, chain: chainId, type: 'approval' })
    await this._waitForReceipt(approval.hash)

    // WDK's EVM account signs through ethers, whose provider answers an identical
    // request from cache for 250 ms. On a fast chain (Robinhood Chain's blocks are
    // ~100 ms) the approval can confirm inside that window, and the swap would then
    // be signed with the approval's nonce ("nonce too low"). Let the cache expire.
    await new Promise(resolve => setTimeout(resolve, this._config.approvalSettleMs ?? APPROVAL_SETTLE_MS))
  }

  /** @private */
  async _send (tx) {
    const result = await this._account.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value ?? 0),
      ...(tx.gas != null ? { gasLimit: BigInt(tx.gas) } : {})
    })
    return result.hash
  }

  /** @private */
  async _waitForReceipt (hash) {
    const timeoutMs = this._config.receiptTimeoutMs ?? 180_000
    const pollMs = this._config.receiptPollMs ?? 2_000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const receipt = await this._receipt(hash)
      if (receipt) {
        if (!receiptSucceeded(receipt)) throw new LcxLibertyTransactionRevertedError(hash)
        return receipt
      }
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
    throw new LcxLibertyTimeoutError(hash)
  }

  // ---------------------------------------------------------------------------
  // Chain access
  // ---------------------------------------------------------------------------

  /** @private */
  async _getChainId () {
    if (this._chainId == null) {
      this._chainId = Number(BigInt(await this._rpc('eth_chainId', [])))
    }
    return this._chainId
  }

  /** @private */
  async _address (required) {
    if (this._account && typeof this._account.getAddress === 'function') {
      try {
        return await this._account.getAddress()
      } catch (error) {
        if (required) throw error
      }
    }
    if (required) throw new LcxLibertyAccountRequiredError()
    return undefined
  }

  /** @private */
  async _receipt (hash) {
    if (this._account && typeof this._account.getTransactionReceipt === 'function') {
      return this._account.getTransactionReceipt(hash)
    }
    return this._rpc('eth_getTransactionReceipt', [hash])
  }

  /** @private */
  async _transaction (hash) {
    if (this._account && typeof this._account.getTransaction === 'function') {
      return this._account.getTransaction(hash)
    }
    return this._rpc('eth_getTransactionByHash', [hash])
  }

  /** @private */
  async _rpc (method, params) {
    const provider = this._provider
    if (provider && typeof provider.request === 'function') {
      return provider.request({ method, params })
    }
    if (typeof provider === 'string') {
      const response = await this._fetch(provider, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      })
      const payload = await response.json()
      if (payload.error) throw new LcxLibertyApiError(`RPC ${method} failed: ${payload.error.message ?? 'unknown error'}`, { code: 'rpc_error' })
      return payload.result
    }
    throw new ProviderRequiredError('Set config.chainId and config.provider, or bind a wallet account connected to a provider.')
  }

  /** @private */
  async _loadChains () {
    if (!this._chains) {
      const data = await this._api.chains()
      this._chains = data?.chains ?? data ?? []
    }
    return this._chains
  }

  /** @private */
  async _resolveChain (value) {
    if (typeof value === 'number' || typeof value === 'bigint') return Number(value)
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
    const key = String(value).toLowerCase()
    if (CHAIN_ALIASES[key] != null) return CHAIN_ALIASES[key]
    const chain = (await this._loadChains()).find(c => c.key?.toLowerCase() === key || c.name?.toLowerCase() === key)
    if (chain) return chain.chainId
    throw new LcxLibertyUnsupportedError(`LCX Liberty DEX does not serve a chain named '${value}'.`)
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function normalizeToken (token, field) {
  if (typeof token !== 'string') throw new InvalidTokenError(`${field} must be a token address.`)
  if (NATIVE_ALIASES.has(token.toLowerCase())) return NATIVE
  if (!ADDRESS.test(token)) throw new InvalidTokenError(`${field} '${token}' is not an EVM token address.`)
  return token
}

function isNative (token) {
  return token.toLowerCase() === NATIVE
}

function slippageToBps (slippage) {
  if (typeof slippage !== 'number' || !Number.isFinite(slippage) || slippage <= 0 || slippage > MAX_SLIPPAGE) {
    throw new LcxLibertyValidationError(`slippage must be a decimal above 0 and at most ${MAX_SLIPPAGE} (20%).`)
  }
  return Math.max(1, Math.round(slippage * 10_000))
}

function receiptSucceeded (receipt) {
  return receipt.status === 1 || receipt.status === 1n || receipt.status === true || receipt.status === '0x1'
}

function toBigInt (value) {
  try {
    return value == null ? 0n : BigInt(value)
  } catch {
    return 0n
  }
}

/** @returns {SwidgeFee[]} */
function sameChainFees (plan, quote) {
  /** @type {SwidgeFee[]} */
  const fees = []
  const gas = toBigInt(quote.gasEstimateWei)
  if (gas > 0n) {
    fees.push({
      type: 'network',
      amount: gas,
      token: NATIVE,
      chain: plan.fromChainId,
      included: false,
      description: 'Network fee for the swap transaction (an approval, when needed, is extra).'
    })
  }
  const integratorFee = toBigInt(quote.fee?.amount)
  if (integratorFee > 0n) {
    fees.push({
      type: 'affiliate',
      amount: integratorFee,
      token: quote.fee.token,
      chain: plan.fromChainId,
      included: true,
      description: 'Integrator fee, already taken from the quoted output.'
    })
  }
  return fees
}

/** @returns {SwidgeFee[]} */
function crossChainFees (plan, quote) {
  /** @type {SwidgeFee[]} */
  const fees = []
  for (const leg of quote.legs ?? []) {
    if (leg.kind === 'swap' && Number(leg.chainId) === plan.fromChainId) {
      const gas = toBigInt(leg.gasEstimateWei)
      if (gas > 0n) {
        fees.push({ type: 'network', amount: gas, token: NATIVE, chain: plan.fromChainId, included: false, description: 'Network fee for the source-chain swap.' })
      }
    }
    if (leg.kind === 'bridge') {
      for (const fee of leg.fees ?? []) {
        const amount = toBigInt(fee.amount)
        if (amount > 0n) {
          fees.push({
            type: 'protocol',
            amount,
            token: fee.token,
            chain: leg.fromChainId,
            included: true,
            description: `${feeLabel(leg.adapter, fee.name)}, already taken from the quoted output.`
          })
        }
      }
    }
  }
  return fees
}

// "across" + "relayerCapitalFee" -> "Across relayer capital fee".
function feeLabel (adapter, name) {
  const bridge = adapter ? adapter.charAt(0).toUpperCase() + adapter.slice(1) : 'Bridge'
  const words = String(name ?? 'fee').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
  return `${bridge} ${words}`
}

function sameChainNetworkBps (quote) {
  if (toBigInt(quote.gasEstimateWei) === 0n) return 0
  const gasUsd = Number(quote.gasFeeUSD)
  const inputUsd = Number(quote.usdValueIn)
  if (!Number.isFinite(gasUsd) || !Number.isFinite(inputUsd) || inputUsd <= 0) return null
  return (gasUsd / inputUsd) * 10_000
}

function bridgeLeg (quote) {
  return (quote.legs ?? []).find(leg => leg.kind === 'bridge')
}

function bridgeFeeBps (quote) {
  const leg = bridgeLeg(quote)
  const bridged = Number(toBigInt(leg?.amountIn))
  if (!leg || bridged <= 0) return null
  let total = 0
  for (const fee of leg.fees ?? []) {
    const amount = Number(toBigInt(fee.amount))
    if (amount === 0) continue
    if (String(fee.token).toLowerCase() !== String(leg.tokenIn).toLowerCase()) return null
    total += amount
  }
  return (total / bridged) * 10_000
}

// The bridged value in USD, from the bridge's own fee rows (amount and its USD value
// give the price of the bridged token); the gas estimate is measured against it.
function crossChainNetworkBps (quote) {
  const gasUsd = Number(quote.gasFeeUSD)
  if (quote.gasFeeUSD == null) return null
  if (gasUsd === 0) return 0
  const leg = bridgeLeg(quote)
  const bridged = Number(toBigInt(leg?.amountIn))
  const priced = (leg?.fees ?? []).find(fee => Number(fee.amountUsd) > 0 && toBigInt(fee.amount) > 0n &&
    String(fee.token).toLowerCase() === String(leg.tokenIn).toLowerCase())
  if (!priced || bridged <= 0) return null
  const bridgedUsd = (Number(priced.amountUsd) / Number(toBigInt(priced.amount))) * bridged
  return bridgedUsd > 0 ? (gasUsd / bridgedUsd) * 10_000 : null
}

/** @returns {SwidgeStatusResult} */
function transferStatus (transfer) {
  let status = TRANSFER_STATUS[transfer.state] ?? 'pending'
  if (transfer.state === 'DST_FALLBACK') {
    const asked = String(transfer.intendedTokenOut ?? transfer.tokenOut ?? '').toLowerCase()
    const delivered = String(transfer.deliveredToken ?? '').toLowerCase()
    status = delivered && asked && delivered !== asked ? 'partial' : 'completed'
  }

  /** @type {SwidgeTransaction[]} */
  const transactions = []
  if (transfer.srcTxHash) transactions.push({ hash: transfer.srcTxHash, chain: transfer.srcChainId, type: 'source' })
  if (transfer.dstTxHash) transactions.push({ hash: transfer.dstTxHash, chain: transfer.dstChainId, type: 'destination' })
  if (transfer.refundTxHash) transactions.push({ hash: transfer.refundTxHash, type: 'refund' })
  return { status, transactions }
}
