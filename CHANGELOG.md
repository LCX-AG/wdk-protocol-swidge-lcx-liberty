# Changelog

## 1.0.0-beta.1

First release.

- `LcxLibertySwidgeProtocol` implements WDK's `SwidgeProtocol` for LCX Liberty DEX: same-chain swaps, and
  cross-chain swap-and-bridge routes from a single source transaction.
- Exact-input quotes and execution, with `minAmountOut`, `maxNetworkFeeBps` and `maxProtocolFeeBps`
  (fail closed).
- Approves the input token only when the allowance is short, for the exact amount, and resets USDT on
  Ethereum to zero first.
- `getSwidgeStatus` reads same-chain swidges from the receipt and cross-chain swidges from the LCX
  Liberty transfer tracker, mapped to WDK statuses.
- `getSupportedChains` and `getSupportedTokens` from the live API.
- Retries a rate-limited (429) call after the wait the API asks for; `getSupportedTokens` fetches one chain at a time.
- Every error extends a WDK standard error.
