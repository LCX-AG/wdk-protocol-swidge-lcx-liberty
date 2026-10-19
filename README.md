# @lcx/wdk-protocol-swidge-lcx-liberty

[![Powered by WDK](https://img.shields.io/badge/Powered%20by-WDK-blueviolet)](https://docs.wdk.tether.io)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

WDK swidge module for [LCX Liberty DEX](https://dex.lcx.com). Any WDK EVM wallet account can use it
to swap on one chain, or swap and bridge to another chain, through the `ISwidgeProtocol` interface.

- **Same-chain swaps** are priced across every venue LCX Liberty DEX indexes on that chain. LCX Liberty
  DEX takes no protocol fee on the swap.
- **Cross-chain routes** swap and bridge from a single source transaction. LCX Liberty DEX tracks
  the transfer through to delivery.

This module implements [`SwidgeProtocol`](https://github.com/tetherto/wdk-wallet/blob/main/src/protocols/swidge-protocol.js)
from `@tetherto/wdk-wallet`, so it also covers `ISwapProtocol` and `IBridgeProtocol`: `swap`, `quoteSwap`,
`bridge` and `quoteBridge` are inherited.

## Install

```bash
npm install @lcx/wdk-protocol-swidge-lcx-liberty @tetherto/wdk-wallet-evm
```

## Get an API key

The LCX Liberty Swap API (`https://swap-api.lcx.com`) needs a key. Create one in the
[LCX Liberty dashboard](https://dex.lcx.com/dashboard). Keys look like `lbk_live_` followed by 48 hex
characters, and the module sends yours as `Authorization: Bearer <key>`.

Read [Storing the API key](#storing-the-api-key) before you ship the key in an app.

## Usage

### Swap on one chain

```js
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import LcxLibertySwidgeProtocol from '@lcx/wdk-protocol-swidge-lcx-liberty'

const account = new WalletAccountEvm(seedPhrase, "0'/0/0", { provider: 'https://mainnet.base.org' })

const protocol = new LcxLibertySwidgeProtocol(account, {
  apiKey: process.env.LCX_API_KEY,
  chainId: 8453 // optional: read from the provider when omitted
})

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

// Non-binding quote: 100 USDC to ETH on Base.
const quote = await protocol.quoteSwidge({
  fromToken: USDC,
  toToken: 'native',
  fromTokenAmount: 100_000_000n, // base units: 100 USDC (6 decimals)
  slippage: 0.005 // 0.5%
})

// Execute. The module approves USDC to the LCX Liberty router if the allowance is short.
const result = await protocol.swidge({
  fromToken: USDC,
  toToken: 'native',
  fromTokenAmount: 100_000_000n,
  slippage: 0.005,
  minAmountOut: quote.toTokenAmountMin // refuse if the fresh quote is worse than what the user saw
})

const { status } = await protocol.getSwidgeStatus(result.id)
```

### Swap and bridge to another chain

```js
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'

const result = await protocol.swidge({
  fromToken: USDC,
  toToken: USDC_POLYGON,
  toChain: 'polygon', // a chain name or a chain id
  fromTokenAmount: 100_000_000n
})

// result.id is 'xchain:<intentId>'. Poll until the status is no longer 'pending'.
const { status, transactions } = await protocol.getSwidgeStatus(result.id)
```

A cross-chain swidge always delivers to the sending wallet's address on the destination chain.

### Discovery and quotes without a wallet

```js
const protocol = new LcxLibertySwidgeProtocol(undefined, {
  apiKey: process.env.LCX_API_KEY,
  chainId: 1 // or provider: 'https://...'
})

const chains = await protocol.getSupportedChains()
const tokens = await protocol.getSupportedTokens({ fromChain: 'base' })
```

Quoting a cross-chain route without a wallet needs `options.recipient`.

More in [examples/](examples).

## Configuration

```js
new LcxLibertySwidgeProtocol(account, {
  apiKey: process.env.LCX_API_KEY, // required for https://swap-api.lcx.com
  baseUrl: 'https://swap-api.lcx.com', // or your own proxy, which then adds the key
  integrator: 'my-wallet', // a slug LCX registered for you, or your fee-recipient address (same-chain swaps)

  chainId: 8453, // the account's chain; read from the provider when omitted
  provider: 'https://...', // JSON-RPC URL or EIP-1193 provider; defaults to the account's

  defaultSlippage: 0.005, // decimal; the API default is 0.005 (0.5%), maximum 0.2 (20%)
  deadlineSecs: 300, // validity of a same-chain swap transaction; maximum 3600

  // WDK fee caps, in basis points of the input value. Both fail closed:
  // a cap that is set but cannot be measured refuses the swidge.
  maxNetworkFeeBps: 100,
  maxProtocolFeeBps: 50,

  tokensPerChain: 200, // getSupportedTokens page size per chain (1-200)
  timeoutMs: 30_000, // per API request
  receiptTimeoutMs: 180_000, // how long swidge() waits for an approval to confirm
  receiptPollMs: 2_000,
  approvalSettleMs: 500, // pause between an approval confirming and the swap being signed
  fetch: globalThis.fetch // for runtimes without a global fetch
})
```

The API refuses an `integrator` it cannot resolve, so that a partner's volume is never credited to
nobody. Ask LCX to register your slug, or pass your fee-recipient address.

You can also pass fee caps, and `deadlineSecs`, on a single call:

```js
await protocol.swidge(options, { maxNetworkFeeBps: 20 })
```

### Options

| `SwidgeOptions` field | Supported | Notes |
| --- | --- | --- |
| `fromToken`, `toToken` | Yes | Token addresses. For the native coin use `'native'`, the zero address, or `0xEeee…EEeE`. |
| `fromTokenAmount` | Yes | Base units, as a `bigint`. |
| `toTokenAmount` | **No** | LCX Liberty DEX quotes exact-input only, so this throws `LcxLibertyUnsupportedError`. |
| `toChain` | Yes | A chain id, or a name such as `'ethereum'`, `'base'`, `'arbitrum'`, `'optimism'`, `'polygon'`, `'bsc'`, `'avalanche'` or `'robinhood'`. Other names are looked up in `getSupportedChains()`. Omit it to stay on the same chain. |
| `recipient` | Yes | Same-chain: any address. Cross-chain: must be the sending wallet. |
| `refundAddress` | Ignored | A failed cross-chain transfer refunds the sending wallet. |
| `slippage` | Yes | A decimal: 0.005 is 0.5%. |
| `minAmountOut` | Yes | Checked against the fresh execution quote before any approval or transaction is sent. |

`swidge()` always fetches a fresh quote. Quotes are short-lived: about 120 seconds for a same-chain
swap and about 25 seconds for a cross-chain route.

## Storing the API key

The key identifies your account, counts against your plan's rate limit, and appears in your usage.
Treat it like any other server credential, and keep it out of code that runs on a user's device.

**Wallets with a backend (custodial, server-side signing, bots).** Load the key from the environment
or a secrets manager and pass it as `apiKey`:

```js
new LcxLibertySwidgeProtocol(account, { apiKey: process.env.LCX_API_KEY })
```

In the dashboard, pin the key to your servers' IP addresses. A pinned key is refused from anywhere
else, so a leaked copy cannot be used.

**Mobile and desktop wallets (WDK on Bare, React Native, Electron).** Do not put the key in the app.
Anyone can read it out of an app bundle. Run a small proxy that adds the key, and point the module at it:

```js
new LcxLibertySwidgeProtocol(account, { baseUrl: 'https://swap.your-wallet.com' }) // no apiKey
```

[examples/proxy.js](examples/proxy.js) is a dependency-free proxy. It forwards only the six endpoints
this module uses, and you can add your own authentication and rate limiting to it.

**Browser wallets and extensions.** Use the proxy. You can also pin a key to your web origin in the
dashboard, which stops other websites from using it. But origin pinning relies on the `Origin` header,
and only a browser sets that honestly, so a proxy is still the safer choice.

Use one key per product or partner. You can then see each one's usage and rotate one without
touching the others.

## Status

`swidge()` returns an `id` that `getSwidgeStatus()` understands:

| Route | `id` | Read from |
| --- | --- | --- |
| Same chain | `<chainId>:<txHash>` | The transaction receipt, through the account or `config.provider`. Pass a bare hash with `{ fromChain }` if you have one. |
| Cross chain | `xchain:<intentId>` | The LCX Liberty transfer tracker. |

| Tracker state | WDK status |
| --- | --- |
| `UNKNOWN`, `QUOTED`, `SUBMITTED`, `SRC_CONFIRMED`, `BRIDGE_PENDING`, `BRIDGE_COMPLETE`, `NEEDS_ATTENTION` | `pending` |
| `DST_EXECUTED`, `DONE` | `completed` |
| `DST_FALLBACK` | `partial` when the token delivered is not the one asked for (for example, the bridged token after a destination swap could not run), otherwise `completed` |
| `REFUND_PENDING` | `refund-pending` |
| `REFUND_CLAIMABLE`, `AWAITING_ACTION` | `action-required` |
| `REFUNDED` | `refunded` |
| `EXPIRED` | `expired` |

`transactions` lists the source transaction, plus the destination and refund transactions once they exist.

## Fees

| WDK fee type | What it is | `included` |
| --- | --- | --- |
| `network` | Gas for the swap (same chain) or for the source-chain swap (cross chain), in the native coin. An approval, when one is needed, costs extra. | `false` |
| `affiliate` | Your integrator fee, when LCX has set one up for your `integrator`. | `true`: already taken from the quoted output |
| `protocol` | Bridge fees on a cross-chain route, one row per fee, in the bridged token. | `true`: already taken from the quoted output |

How each cap is measured:

- `maxNetworkFeeBps` compares the quote's USD gas estimate with the USD value of the input.
- `maxProtocolFeeBps` compares the bridge fees with the amount bridged. A same-chain route has no
  protocol fee, so this cap never refuses one.

## Errors

Every error extends one of WDK's standard error classes. You can handle this module the way you
handle any other swidge provider, and read `code` when you want the detail.

| Error | Extends | When |
| --- | --- | --- |
| `LcxLibertyValidationError` | `ValueError` | Bad options or configuration, including a missing API key. |
| `LcxLibertyUnsupportedError` | `ValueError` | Exact-output, a cross-chain recipient other than the sender, or an unknown chain. |
| `InvalidTokenError` (WDK) | `WdkError` | A token that is not an address or a native alias. |
| `LcxLibertyAccountRequiredError` | `AccountRequiredError` | `swidge()` without a signing account. |
| `LcxLibertyApiError` | `ProviderError` | An API error, timeout or network failure. `code` is the API's code, `status` the HTTP status, and `retryAfter` the seconds to wait when the status is 429. |
| `LcxLibertyNoRouteError` | `LcxLibertyApiError` | No route for this pair, amount or chain pair right now. |
| `LcxLibertyFeeLimitExceededError` | `MaximumFeeExceededError` | A fee cap was exceeded or could not be measured. |
| `LcxLibertyMinAmountOutError` | `SwidgeError` | The fresh quote guarantees less than `minAmountOut`. |
| `LcxLibertyTransactionRevertedError` | `SwidgeError` | An approval the module sent reverted. |
| `LcxLibertyTimeoutError` | `SwidgeError` | An approval did not confirm within `receiptTimeoutMs`. |
| `LcxLibertyUnknownSwidgeError` | `NoSuchElementError` | `getSwidgeStatus()` found no such swidge. |

## Supported chains

The EVM chains LCX Liberty DEX currently serves. `getSupportedChains()` always returns the current list.

## Limitations

- Exact-input only.
- A cross-chain swidge delivers to the sending wallet.
- EVM only. Tested with `@tetherto/wdk-wallet-evm` externally owned accounts; ERC-4337 smart
  accounts are not tested yet.

## Development

```bash
npm install
npm test          # unit tests, no network
npm run lint
npm run build:types
```

`tests/e2e/fork-base.js` runs three real swidges against a local fork of Base: native in, ERC-20 in
with an approval, and the source leg of a cross-chain route. No real funds move.

```bash
anvil --fork-url <base rpc> --port 8547
LCX_API_KEY=lbk_live_... npm run e2e
```

## License

Apache-2.0
