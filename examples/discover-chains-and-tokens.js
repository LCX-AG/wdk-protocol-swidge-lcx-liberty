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

// Lists the chains LCX Liberty DEX serves and a few tokens on each. No wallet needed.
//
//   LCX_API_KEY=lbk_live_... node examples/discover-chains-and-tokens.js

import LcxLibertySwidgeProtocol from '../index.js'

const protocol = new LcxLibertySwidgeProtocol(undefined, {
  apiKey: process.env.LCX_API_KEY,
  baseUrl: process.env.LCX_BASE_URL, // set when you go through your own proxy
  tokensPerChain: 5
})

for (const chain of await protocol.getSupportedChains()) {
  const tokens = await protocol.getSupportedTokens({ fromChain: chain.id })
  console.log(`${chain.name} (${chain.id}, ${chain.nativeToken}): ${tokens.map(t => t.symbol).join(', ')}`)
}
