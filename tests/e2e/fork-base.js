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

// End-to-end run against a LOCAL FORK of Base. No real funds move.
//
//   anvil --fork-url <base rpc> --port 8547
//   LCX_API_KEY=lbk_live_... FORK_RPC=http://127.0.0.1:8547 npm run e2e
//
// The default mnemonic is anvil's public test mnemonic, whose first account the
// fork funds with 10,000 ETH. Quotes and transactions come from the real API;
// the transactions are sent to the fork only.

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

import LcxLibertySwidgeProtocol from '../../index.js'

const FORK_RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8547'
const MNEMONIC = process.env.MNEMONIC ?? 'test test test test test test test test test test test junk'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'

const config = { apiKey: process.env.LCX_API_KEY }
if (process.env.LCX_BASE_URL) config.baseUrl = process.env.LCX_BASE_URL

const log = (...args) => console.log(...args)
const show = value => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)

async function main () {
  const account = new WalletAccountEvm(MNEMONIC, "0'/0/0", { provider: FORK_RPC })
  const protocol = new LcxLibertySwidgeProtocol(account, config)
  const address = await account.getAddress()
  log('Account:', address, '| ETH:', (await account.getBalance()).toString())

  // 1. Native in: no approval.
  const ethToUsdc = await protocol.swidge({ fromToken: 'native', toToken: USDC_BASE, fromTokenAmount: 5n * 10n ** 16n, slippage: 0.01 })
  log('\n1. 0.05 ETH -> USDC:', show(ethToUsdc))
  await waitFor(protocol, ethToUsdc.id)
  const usdc = await account.getTokenBalance(USDC_BASE)
  log('   USDC balance after:', usdc.toString())

  // 2. ERC-20 in: needs an approval to the router, which swidge sends and waits for.
  const usdcToEth = await protocol.swidge({ fromToken: USDC_BASE, toToken: 'native', fromTokenAmount: usdc / 2n, slippage: 0.01 })
  log('\n2. half the USDC -> ETH:', show(usdcToEth))
  log('   approvals sent:', usdcToEth.transactions.filter(tx => tx.type === 'approval').length)
  await waitFor(protocol, usdcToEth.id)

  // 3. Cross-chain: only the source transaction can run on a fork; the bridge
  //    never sees it, so the tracker will not progress. This checks the build,
  //    the exact approval to the bridge entry point, and the send.
  const remaining = await account.getTokenBalance(USDC_BASE)
  const toPolygon = await protocol.swidge({ fromToken: USDC_BASE, toToken: USDC_POLYGON, toChain: 'polygon', fromTokenAmount: remaining, slippage: 0.01 })
  log('\n3. USDC Base -> Polygon (source leg only):', show(toPolygon))
  const receipt = await account.getTransactionReceipt(toPolygon.hash)
  log('   source transaction status on the fork:', receipt?.status)
  log('   USDC left on Base:', (await account.getTokenBalance(USDC_BASE)).toString())
}

async function waitFor (protocol, id) {
  for (let i = 0; i < 30; i++) {
    const status = await protocol.getSwidgeStatus(id)
    if (status.status !== 'pending') {
      log('   status:', status.status)
      if (status.status !== 'completed') throw new Error(`swidge ${id} ended as ${status.status}`)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`swidge ${id} still pending`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
