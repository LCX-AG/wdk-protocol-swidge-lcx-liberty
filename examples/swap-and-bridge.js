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

// Quotes, then executes, 10 USDC on Base to USDC on Polygon, and follows the
// transfer to delivery. THIS SENDS REAL TRANSACTIONS from the seed phrase's
// first account. Set EXECUTE=1 to send; without it the script only quotes.
//
//   SEED_PHRASE="..." LCX_API_KEY=lbk_live_... node examples/swap-and-bridge.js

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

import LcxLibertySwidgeProtocol from '../index.js'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'

const account = new WalletAccountEvm(process.env.SEED_PHRASE, "0'/0/0", {
  provider: process.env.BASE_RPC ?? 'https://mainnet.base.org'
})
const protocol = new LcxLibertySwidgeProtocol(account, {
  apiKey: process.env.LCX_API_KEY,
  baseUrl: process.env.LCX_BASE_URL, // set when you go through your own proxy
  maxProtocolFeeBps: 50, // refuse if the bridge takes more than 0.5%
  maxNetworkFeeBps: 100 // or if gas costs more than 1% of the amount
})

const options = {
  fromToken: USDC_BASE,
  toToken: USDC_POLYGON,
  toChain: 'polygon',
  fromTokenAmount: 10_000_000n, // 10 USDC
  slippage: 0.005
}

const quote = await protocol.quoteSwidge(options)
console.log(`Receive at least ${quote.toTokenAmountMin} (≈ ${quote.toTokenAmount}) USDC units on Polygon in ~${quote.estimatedDuration}s`)
for (const fee of quote.fees) console.log(`  ${fee.type}: ${fee.amount} of ${fee.token} (${fee.description})`)

if (process.env.EXECUTE !== '1') process.exit(0)

const result = await protocol.swidge({ ...options, minAmountOut: quote.toTokenAmountMin })
console.log('Sent', result.hash, 'id', result.id)

for (;;) {
  const { status, transactions } = await protocol.getSwidgeStatus(result.id)
  console.log(status, transactions.map(tx => `${tx.type}:${tx.hash}`).join(' '))
  if (status !== 'pending') break
  await new Promise(resolve => setTimeout(resolve, 3_000))
}
