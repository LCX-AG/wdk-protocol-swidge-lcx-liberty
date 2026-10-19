import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { InvalidTokenError, MaximumFeeExceededError, NoSuchElementError, ProviderError, SwidgeError, ValueError } from '@tetherto/wdk-wallet/protocols'

import LcxLibertySwidgeProtocol, {
  LcxLibertyAccountRequiredError,
  LcxLibertyApiError,
  LcxLibertyFeeLimitExceededError,
  LcxLibertyMinAmountOutError,
  LcxLibertyNoRouteError,
  LcxLibertyUnknownSwidgeError,
  LcxLibertyUnsupportedError,
  LcxLibertyValidationError
} from '../index.js'

const NATIVE = '0x0000000000000000000000000000000000000000'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ROUTER = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0'
const SPOKE = '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64'
const WALLET = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'
const HASH = '0x' + 'ab'.repeat(32)
const HASH2 = '0x' + 'cd'.repeat(32)
const INTENT = '0x' + 'ef'.repeat(32)

const SAME_CHAIN_QUOTE = {
  quoteId: 'q_' + 'a'.repeat(32),
  chainId: 8453,
  input: { token: USDC_BASE, amount: '100000000', decimals: 6 },
  output: { token: NATIVE, decimals: 18, amount: '40000000000000000', minimumAmount: '39800000000000000' },
  fee: { bps: 0, amount: '0', token: NATIVE, usd: null, integrator: null, integratorSource: 'none', grossAmount: '40000000000000000' },
  priceImpactPct: 0.05,
  usdValueIn: 100,
  usdValueOut: 99.9,
  gasEstimateWei: '900000000000',
  gasFeeUSD: 0.003,
  slippageBps: 50,
  nativeIn: false,
  nativeOut: true,
  expiresAt: 1800000000,
  spender: ROUTER
}

const SAME_CHAIN_BUILD = {
  routerDeployed: true,
  swap: { to: ROUTER, data: '0xdeadbeef', value: '0', chainId: 8453, gas: '250000' },
  minAmountOut: '39800000000000000',
  amountOut: '40000000000000000',
  deadline: '1800000300',
  simulation: { status: 'skipped', why: 'awaiting_allowance' }
}

const CROSS_CHAIN_QUOTE = {
  type: 'CROSS_CHAIN',
  shape: 'DIRECT',
  quoteId: 'xq_8453_137_1_1800000000',
  fromChainId: 8453,
  toChainId: 137,
  tokenIn: USDC_BASE.toLowerCase(),
  tokenOut: USDC_POLYGON.toLowerCase(),
  amountIn: '100000000',
  recipient: WALLET,
  legs: [{
    kind: 'bridge',
    adapter: 'across',
    fromChainId: 8453,
    toChainId: 137,
    tokenIn: USDC_BASE.toLowerCase(),
    tokenOut: USDC_POLYGON.toLowerCase(),
    amountIn: '100000000',
    out: '99980000',
    minOut: '99980000',
    etaSec: 2,
    fees: [
      { name: 'relayerCapitalFee', amount: '10000', token: USDC_BASE.toLowerCase(), amountUsd: 0.01 },
      { name: 'relayerGasFee', amount: '10000', token: USDC_BASE.toLowerCase(), amountUsd: 0.01 }
    ]
  }],
  endToEndOut: '99980000',
  endToEndMinOut: '99980000',
  netOut: '99980000',
  etaSec: 2,
  gasFeeUSD: 0.01,
  approval: { target: SPOKE, amount: '100000000' },
  expiresAt: 1800000025
}

const CROSS_CHAIN_BUILD = {
  type: 'CROSS_CHAIN',
  quoteId: CROSS_CHAIN_QUOTE.quoteId,
  intentId: INTENT,
  approval: { target: SPOKE, amount: '100000000' },
  transactionRequest: { chainId: 8453, from: WALLET, to: SPOKE, data: '0xfeed', value: '0', gas: '180000' },
  endToEndOut: '99980000',
  endToEndMinOut: '99980000',
  tracking: { intentId: INTENT }
}

const CHAINS = {
  chains: [
    { chainId: 1, key: 'ethereum', name: 'Ethereum', nativeSymbol: 'ETH', routerDeployed: true },
    { chainId: 8453, key: 'base', name: 'Base', nativeSymbol: 'ETH', routerDeployed: true },
    { chainId: 137, key: 'polygon', name: 'Polygon', nativeSymbol: 'POL', routerDeployed: true },
    { chainId: 4663, key: 'robinhood', name: 'Robinhood Chain', nativeSymbol: 'ETH', routerDeployed: true },
    { chainId: 999, key: 'hyperevm', name: 'HyperEVM', nativeSymbol: 'HYPE', routerDeployed: false }
  ]
}

function ok (data) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ success: true, data }) }
}

function fail (status, code, message = code, headers = {}) {
  return {
    ok: false,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    json: async () => ({ success: false, code, error: code, message })
  }
}

/** A fetch double that answers by path and records every call. */
function fakeApi (routes) {
  const calls = []
  const fetch = jest.fn(async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url)
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method: init.method, path: pathname, query: Object.fromEntries(searchParams), body, headers: init.headers })
    const handler = routes[`${init.method} ${pathname}`] ?? routes[pathname]
    if (!handler) return fail(404, 'not_found')
    return typeof handler === 'function' ? handler({ body, query: Object.fromEntries(searchParams) }) : handler
  })
  return { fetch, calls }
}

function fakeAccount ({ allowance = 0n } = {}) {
  let nonce = 0
  return {
    getAddress: jest.fn(async () => WALLET),
    getAllowance: jest.fn(async () => allowance),
    approve: jest.fn(async () => ({ hash: '0x' + String(++nonce).padStart(64, '0') })),
    sendTransaction: jest.fn(async () => ({ hash: HASH })),
    getTransactionReceipt: jest.fn(async () => ({ status: 1 })),
    getTransaction: jest.fn(async () => ({ hash: HASH }))
  }
}

const BASE_CONFIG = { apiKey: 'lbk_live_' + '0'.repeat(48), chainId: 8453, receiptPollMs: 1, approvalSettleMs: 0 }

describe('LcxLibertySwidgeProtocol', () => {
  describe('constructor', () => {
    test('requires an API key for the hosted API', () => {
      expect(() => new LcxLibertySwidgeProtocol(undefined, { chainId: 8453 })).toThrow(LcxLibertyValidationError)
    })

    test('allows no key when baseUrl is the caller\'s own proxy', () => {
      expect(() => new LcxLibertySwidgeProtocol(undefined, { baseUrl: 'https://proxy.example.com', chainId: 8453 })).not.toThrow()
    })

    test('rejects a default slippage outside (0, 0.2]', () => {
      expect(() => new LcxLibertySwidgeProtocol(undefined, { ...BASE_CONFIG, defaultSlippage: 0.5 })).toThrow(ValueError)
    })
  })

  describe('quoteSwidge', () => {
    let api, protocol

    beforeEach(() => {
      api = fakeApi({
        'POST /v1/quote': ({ body }) => ok(body.toChainId ? { quote: CROSS_CHAIN_QUOTE } : { quote: SAME_CHAIN_QUOTE, permitData: null }),
        'GET /v1/chains': ok(CHAINS)
      })
      protocol = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: api.fetch })
    })

    test('quotes a same-chain swap in base units, with the key as a bearer token', async () => {
      const quote = await protocol.quoteSwidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 100_000_000n, slippage: 0.005 })

      expect(api.calls[0].body).toEqual({ chainId: 8453, tokenIn: USDC_BASE, tokenOut: NATIVE, amountIn: '100000000', slippageBps: 50 })
      expect(api.calls[0].headers.Authorization).toBe(`Bearer ${BASE_CONFIG.apiKey}`)
      expect(quote).toEqual({
        fromTokenAmount: 100_000_000n,
        toTokenAmount: 40_000_000_000_000_000n,
        toTokenAmountMin: 39_800_000_000_000_000n,
        fees: [expect.objectContaining({ type: 'network', amount: 900_000_000_000n, token: NATIVE, chain: 8453, included: false })],
        estimatedDuration: undefined,
        expiry: 1800000000,
        priceImpact: 0.0005
      })
    })

    test('maps the native-token aliases to the zero address', async () => {
      await protocol.quoteSwidge({ fromToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', toToken: USDC_BASE, fromTokenAmount: 1n })
      expect(api.calls[0].body.tokenIn).toBe(NATIVE)
    })

    test('sends the integrator on same-chain quotes', async () => {
      const withIntegrator = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, integrator: 'my-wallet', fetch: api.fetch })
      await withIntegrator.quoteSwidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n })
      expect(api.calls[0].body.integrator).toBe('my-wallet')
    })

    test('reports an integrator fee as an affiliate fee already in the output', async () => {
      const withFee = fakeApi({ 'POST /v1/quote': ok({ quote: { ...SAME_CHAIN_QUOTE, fee: { ...SAME_CHAIN_QUOTE.fee, amount: '1000', token: NATIVE } } }) })
      const p = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: withFee.fetch })
      const quote = await p.quoteSwidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n })
      expect(quote.fees).toContainEqual(expect.objectContaining({ type: 'affiliate', amount: 1000n, included: true }))
    })

    test('quotes a cross-chain route by chain name, with the account as recipient', async () => {
      const quote = await protocol.quoteSwidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 'polygon', fromTokenAmount: 100_000_000n })

      expect(api.calls[0].body).toEqual({ chainId: 8453, toChainId: 137, tokenIn: USDC_BASE, tokenOut: USDC_POLYGON, amountIn: '100000000', recipient: WALLET })
      expect(quote.toTokenAmount).toBe(99_980_000n)
      expect(quote.toTokenAmountMin).toBe(99_980_000n)
      expect(quote.estimatedDuration).toBe(2)
      expect(quote.fees).toEqual([
        expect.objectContaining({ type: 'protocol', amount: 10_000n, included: true, description: 'Across relayer capital fee, already taken from the quoted output.' }),
        expect.objectContaining({ type: 'protocol', amount: 10_000n, included: true, description: 'Across relayer gas fee, already taken from the quoted output.' })
      ])
    })

    test('resolves a chain name it does not know through /v1/chains', async () => {
      await protocol.quoteSwidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 'Robinhood Chain', fromTokenAmount: 1n })
      expect(api.calls.at(-1).body.toChainId).toBe(4663)
    })

    test('needs a recipient for a cross-chain quote without an account', async () => {
      const accountless = new LcxLibertySwidgeProtocol(undefined, { ...BASE_CONFIG, fetch: api.fetch })
      await expect(accountless.quoteSwidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 1n }))
        .rejects.toThrow(LcxLibertyValidationError)
      await expect(accountless.quoteSwidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 1n, recipient: OTHER }))
        .resolves.toBeDefined()
    })

    test('refuses exact-output', async () => {
      await expect(protocol.quoteSwidge({ fromToken: USDC_BASE, toToken: 'native', toTokenAmount: 1n })).rejects.toThrow(LcxLibertyUnsupportedError)
    })

    test('rejects a token that is not an address', async () => {
      await expect(protocol.quoteSwidge({ fromToken: 'usdc', toToken: 'native', fromTokenAmount: 1n })).rejects.toThrow(InvalidTokenError)
    })

    test.each([
      [{ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 0n }],
      [{ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n, slippage: 0.3 }],
      [{ fromToken: USDC_BASE, toToken: USDC_BASE, fromTokenAmount: 1n }],
      [{ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n, recipient: 'nope' }]
    ])('rejects invalid options %#', async (options) => {
      await expect(protocol.quoteSwidge(options)).rejects.toThrow(ValueError)
    })

    test('turns no_route into LcxLibertyNoRouteError, a ProviderError', async () => {
      const noRoute = fakeApi({ 'POST /v1/quote': fail(400, 'no_route', 'No route for this pair.') })
      const p = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: noRoute.fetch })
      const error = await p.quoteSwidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n }).catch(e => e)
      expect(error).toBeInstanceOf(LcxLibertyNoRouteError)
      expect(error).toBeInstanceOf(ProviderError)
      expect(error.code).toBe('no_route')
    })

    test('keeps Retry-After on a rate limit', async () => {
      const limited = fakeApi({ 'POST /v1/quote': fail(429, 'RATE_LIMITED', 'Slow down.', { 'retry-after': '1' }) })
      const p = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: limited.fetch })
      const error = await p.quoteSwidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n }).catch(e => e)
      expect(error).toBeInstanceOf(LcxLibertyApiError)
      expect(error.status).toBe(429)
      expect(error.retryAfter).toBe(1)
    })
  })

  describe('swidge (same chain)', () => {
    let api

    beforeEach(() => {
      api = fakeApi({
        'POST /v1/quote': ok({ quote: SAME_CHAIN_QUOTE }),
        'POST /v1/build': ok(SAME_CHAIN_BUILD)
      })
    })

    test('approves the router when the allowance is short, then sends the build', async () => {
      const account = fakeAccount({ allowance: 0n })
      const p = new LcxLibertySwidgeProtocol(account, { ...BASE_CONFIG, fetch: api.fetch })

      const result = await p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 100_000_000n })

      expect(api.calls.find(c => c.path === '/v1/build').body).toEqual({ quoteId: SAME_CHAIN_QUOTE.quoteId, recipient: WALLET })
      expect(account.approve).toHaveBeenCalledWith({ token: USDC_BASE, spender: ROUTER, amount: 100_000_000n })
      expect(account.sendTransaction).toHaveBeenCalledWith({ to: ROUTER, data: '0xdeadbeef', value: 0n, gasLimit: 250_000n })
      expect(result.id).toBe(`8453:${HASH}`)
      expect(result.transactions.map(t => t.type)).toEqual(['approval', 'source'])
      expect(result.toTokenAmountMin).toBe(39_800_000_000_000_000n)
    })

    test('skips the approval when the allowance already covers the amount', async () => {
      const account = fakeAccount({ allowance: 10n ** 30n })
      const p = new LcxLibertySwidgeProtocol(account, { ...BASE_CONFIG, fetch: api.fetch })
      const result = await p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 100_000_000n })
      expect(account.approve).not.toHaveBeenCalled()
      expect(result.transactions.map(t => t.type)).toEqual(['source'])
    })

    test('never approves a native input', async () => {
      const account = fakeAccount()
      const p = new LcxLibertySwidgeProtocol(account, { ...BASE_CONFIG, fetch: api.fetch })
      await p.swidge({ fromToken: 'native', toToken: USDC_BASE, fromTokenAmount: 10n ** 17n })
      expect(account.getAllowance).not.toHaveBeenCalled()
      expect(account.approve).not.toHaveBeenCalled()
    })

    test('resets a USDT allowance to zero first on Ethereum', async () => {
      const account = fakeAccount({ allowance: 5n })
      const p = new LcxLibertySwidgeProtocol(account, { ...BASE_CONFIG, chainId: 1, fetch: api.fetch })
      await p.swidge({ fromToken: USDT_ETHEREUM, toToken: 'native', fromTokenAmount: 100n })
      expect(account.approve.mock.calls.map(([args]) => args.amount)).toEqual([0n, 100n])
    })

    test('sends to a different recipient when asked', async () => {
      const p = new LcxLibertySwidgeProtocol(fakeAccount({ allowance: 10n ** 30n }), { ...BASE_CONFIG, fetch: api.fetch })
      await p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n, recipient: OTHER })
      expect(api.calls.find(c => c.path === '/v1/build').body.recipient).toBe(OTHER)
    })

    test('needs a signing account', async () => {
      const readOnly = { getAddress: async () => WALLET }
      const p = new LcxLibertySwidgeProtocol(readOnly, { ...BASE_CONFIG, fetch: api.fetch })
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n })).rejects.toThrow(LcxLibertyAccountRequiredError)
    })

    test('refuses when the guaranteed output is below minAmountOut', async () => {
      const account = fakeAccount({ allowance: 10n ** 30n })
      const p = new LcxLibertySwidgeProtocol(account, { ...BASE_CONFIG, fetch: api.fetch })
      const error = await p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n, minAmountOut: 10n ** 18n }).catch(e => e)
      expect(error).toBeInstanceOf(LcxLibertyMinAmountOutError)
      expect(error).toBeInstanceOf(SwidgeError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('enforces maxNetworkFeeBps from the USD gas estimate', async () => {
      const p = new LcxLibertySwidgeProtocol(fakeAccount({ allowance: 10n ** 30n }), { ...BASE_CONFIG, fetch: api.fetch })
      // gas $0.003 on $100 = 0.3 bps
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n }, { maxNetworkFeeBps: 0.1 }))
        .rejects.toThrow(MaximumFeeExceededError)
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n }, { maxNetworkFeeBps: 1 }))
        .resolves.toBeDefined()
    })

    test('fails closed when the network fee cannot be measured', async () => {
      const unpriced = fakeApi({ 'POST /v1/quote': ok({ quote: { ...SAME_CHAIN_QUOTE, usdValueIn: null } }), 'POST /v1/build': ok(SAME_CHAIN_BUILD) })
      const p = new LcxLibertySwidgeProtocol(fakeAccount({ allowance: 10n ** 30n }), { ...BASE_CONFIG, fetch: unpriced.fetch, maxNetworkFeeBps: 100 })
      const error = await p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n }).catch(e => e)
      expect(error).toBeInstanceOf(LcxLibertyFeeLimitExceededError)
      expect(error.actualBps).toBeNull()
    })

    test('has no protocol fee to cap on a same-chain route', async () => {
      const p = new LcxLibertySwidgeProtocol(fakeAccount({ allowance: 10n ** 30n }), { ...BASE_CONFIG, fetch: api.fetch, maxProtocolFeeBps: 0 })
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: 1n })).resolves.toBeDefined()
    })
  })

  describe('swidge (cross chain)', () => {
    let api

    beforeEach(() => {
      api = fakeApi({
        'POST /v1/quote': ok({ quote: CROSS_CHAIN_QUOTE }),
        'POST /v1/build': ok(CROSS_CHAIN_BUILD),
        [`POST /v1/bridge/transfers/${INTENT}/submitted`]: ok({})
      })
    })

    test('approves the exact amount to the build\'s target, sends, and reports the source to the tracker', async () => {
      const account = fakeAccount({ allowance: 0n })
      const p = new LcxLibertySwidgeProtocol(account, { ...BASE_CONFIG, fetch: api.fetch })

      const result = await p.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 100_000_000n })

      expect(account.approve).toHaveBeenCalledWith({ token: USDC_BASE, spender: SPOKE, amount: 100_000_000n })
      expect(account.sendTransaction).toHaveBeenCalledWith({ to: SPOKE, data: '0xfeed', value: 0n, gasLimit: 180_000n })
      expect(api.calls.at(-1)).toMatchObject({ path: `/v1/bridge/transfers/${INTENT}/submitted`, body: { txHash: HASH } })
      expect(result.id).toBe(`xchain:${INTENT}`)
      expect(result.toTokenAmountMin).toBe(99_980_000n)
    })

    test('still succeeds when the tracker notice fails', async () => {
      const flaky = fakeApi({ 'POST /v1/quote': ok({ quote: CROSS_CHAIN_QUOTE }), 'POST /v1/build': ok(CROSS_CHAIN_BUILD) })
      const p = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: flaky.fetch })
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 100_000_000n })).resolves.toBeDefined()
    })

    test('delivers only to the sending wallet', async () => {
      const p = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: api.fetch })
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 1n, recipient: OTHER }))
        .rejects.toThrow(LcxLibertyUnsupportedError)
    })

    test('refuses a build for another chain', async () => {
      const wrongChain = fakeApi({
        'POST /v1/quote': ok({ quote: CROSS_CHAIN_QUOTE }),
        'POST /v1/build': ok({ ...CROSS_CHAIN_BUILD, transactionRequest: { ...CROSS_CHAIN_BUILD.transactionRequest, chainId: 1 } })
      })
      const account = fakeAccount()
      const p = new LcxLibertySwidgeProtocol(account, { ...BASE_CONFIG, fetch: wrongChain.fetch })
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 1n })).rejects.toThrow(LcxLibertyApiError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('caps the bridge fee as the protocol fee', async () => {
      const p = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: api.fetch })
      // 20,000 of 100,000,000 = 2 bps
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 1n }, { maxProtocolFeeBps: 1 }))
        .rejects.toThrow(MaximumFeeExceededError)
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 1n }, { maxProtocolFeeBps: 5 }))
        .resolves.toBeDefined()
    })

    test('measures the network fee against the bridged value', async () => {
      const p = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: api.fetch })
      // gas $0.01 on 100 USDC priced from the fee rows ($0.01 per 10,000 units) = 1 bps
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 1n }, { maxNetworkFeeBps: 0.5 }))
        .rejects.toThrow(MaximumFeeExceededError)
      await expect(p.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 137, fromTokenAmount: 1n }, { maxNetworkFeeBps: 2 }))
        .resolves.toBeDefined()
    })
  })

  describe('getSwidgeStatus', () => {
    const transfer = (state, extra = {}) => ok({ state, srcChainId: 8453, dstChainId: 137, srcTxHash: HASH, tokenOut: USDC_POLYGON, ...extra })

    test.each([
      ['SUBMITTED', 'pending'],
      ['BRIDGE_PENDING', 'pending'],
      ['NEEDS_ATTENTION', 'pending'],
      ['DONE', 'completed'],
      ['DST_EXECUTED', 'completed'],
      ['REFUND_PENDING', 'refund-pending'],
      ['REFUND_CLAIMABLE', 'action-required'],
      ['REFUNDED', 'refunded'],
      ['EXPIRED', 'expired']
    ])('maps the tracker state %s to %s', async (state, status) => {
      const api = fakeApi({ [`/v1/bridge/transfers/${INTENT}`]: transfer(state) })
      const p = new LcxLibertySwidgeProtocol(undefined, { ...BASE_CONFIG, fetch: api.fetch })
      await expect(p.getSwidgeStatus(`xchain:${INTENT}`)).resolves.toMatchObject({ status })
    })

    test('reports a fallback delivery of another token as partial, with both transactions', async () => {
      const api = fakeApi({ [`/v1/bridge/transfers/${INTENT}`]: transfer('DST_FALLBACK', { deliveredToken: USDC_BASE, dstTxHash: HASH2 }) })
      const p = new LcxLibertySwidgeProtocol(undefined, { ...BASE_CONFIG, fetch: api.fetch })
      await expect(p.getSwidgeStatus(`xchain:${INTENT}`)).resolves.toEqual({
        status: 'partial',
        transactions: [
          { hash: HASH, chain: 8453, type: 'source' },
          { hash: HASH2, chain: 137, type: 'destination' }
        ]
      })
    })

    test('throws NoSuchElementError for an unknown transfer', async () => {
      const api = fakeApi({})
      const p = new LcxLibertySwidgeProtocol(undefined, { ...BASE_CONFIG, fetch: api.fetch })
      const error = await p.getSwidgeStatus(`xchain:${INTENT}`).catch(e => e)
      expect(error).toBeInstanceOf(LcxLibertyUnknownSwidgeError)
      expect(error).toBeInstanceOf(NoSuchElementError)
    })

    test('reads a same-chain swidge from its receipt', async () => {
      const account = fakeAccount()
      const p = new LcxLibertySwidgeProtocol(account, { ...BASE_CONFIG, fetch: fakeApi({}).fetch })
      await expect(p.getSwidgeStatus(`8453:${HASH}`)).resolves.toEqual({ status: 'completed', transactions: [{ hash: HASH, chain: 8453, type: 'source' }] })

      account.getTransactionReceipt.mockResolvedValueOnce({ status: 0 })
      await expect(p.getSwidgeStatus(`8453:${HASH}`)).resolves.toMatchObject({ status: 'failed' })

      account.getTransactionReceipt.mockResolvedValueOnce(null)
      await expect(p.getSwidgeStatus(HASH)).resolves.toMatchObject({ status: 'pending' })

      account.getTransactionReceipt.mockResolvedValueOnce(null)
      account.getTransaction.mockResolvedValueOnce(null)
      await expect(p.getSwidgeStatus(`8453:${HASH}`)).rejects.toThrow(NoSuchElementError)
    })

    test('refuses a same-chain id from another chain', async () => {
      const p = new LcxLibertySwidgeProtocol(fakeAccount(), { ...BASE_CONFIG, fetch: fakeApi({}).fetch })
      await expect(p.getSwidgeStatus(`1:${HASH}`)).rejects.toThrow(ValueError)
    })
  })

  describe('discovery', () => {
    test('lists the chains with a router', async () => {
      const api = fakeApi({ 'GET /v1/chains': ok(CHAINS) })
      const p = new LcxLibertySwidgeProtocol(undefined, { ...BASE_CONFIG, fetch: api.fetch })
      const chains = await p.getSupportedChains()
      expect(chains).toContainEqual({ id: 4663, name: 'Robinhood Chain', type: 'evm', nativeToken: 'ETH' })
      expect(chains.find(c => c.id === 999)).toBeUndefined()
    })

    test('lists tokens for one chain, or for every chain', async () => {
      const api = fakeApi({
        'GET /v1/chains': ok(CHAINS),
        'GET /v1/tokens': ({ query }) => ok({ tokens: [{ address: USDC_BASE, symbol: 'USDC', name: 'USD Coin', decimals: 6, chainId: Number(query.chainId) }] })
      })
      const p = new LcxLibertySwidgeProtocol(undefined, { ...BASE_CONFIG, fetch: api.fetch, tokensPerChain: 50 })

      await expect(p.getSupportedTokens({ fromChain: 'base' })).resolves.toEqual([
        { token: USDC_BASE, chain: 8453, symbol: 'USDC', decimals: 6, address: USDC_BASE, name: 'USD Coin' }
      ])
      expect(api.calls.at(-1).query).toEqual({ chainId: '8453', limit: '50' })

      const all = await p.getSupportedTokens()
      expect(all.map(t => t.chain)).toEqual([1, 8453, 137, 4663])
    })
  })
})
