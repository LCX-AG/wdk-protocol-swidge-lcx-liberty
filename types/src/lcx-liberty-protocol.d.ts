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
    constructor(account?: undefined, config?: LcxLibertySwidgeProtocolConfig);
    /**
     * Creates a read-only protocol: quotes, discovery and status.
     *
     * @overload
     * @param {IWalletAccountReadOnly} account
     * @param {LcxLibertySwidgeProtocolConfig} [config]
     */
    constructor(account: IWalletAccountReadOnly, config?: LcxLibertySwidgeProtocolConfig);
    /**
     * Creates a protocol that can execute swidges with the given account.
     *
     * @overload
     * @param {IWalletAccount} account
     * @param {LcxLibertySwidgeProtocolConfig} [config]
     */
    constructor(account: IWalletAccount, config?: LcxLibertySwidgeProtocolConfig);
    /** @protected */
    protected _api: LcxLibertyApiClient;
    /** @private */
    private _provider;
    /** @private @type {number | undefined} */
    private _chainId;
    /** @private @type {typeof fetch} */
    private _fetch;
    /** @private @type {Array<any> | undefined} */
    private _chains;
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
    swidge(options: SwidgeOptions, config?: SwidgeProtocolConfig & {
        deadlineSecs?: number;
    }): Promise<SwidgeResult>;
    /** @private */
    private _plan;
    /** @private */
    private _quote;
    /**
     * @private
     * @returns {SwidgeQuote}
     */
    private _toSwidgeQuote;
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
    private _checkFeeCaps;
    /** @private */
    private _executeSameChain;
    /** @private */
    private _executeCrossChain;
    /**
     * Approves `amount` of `token` to `spender` unless the current allowance already covers it.
     * USDT on Ethereum refuses a non-zero to non-zero change, so it is reset to zero first.
     *
     * @private
     */
    private _ensureAllowance;
    /** @private */
    private _send;
    /** @private */
    private _waitForReceipt;
    /** @private */
    private _getChainId;
    /** @private */
    private _address;
    /** @private */
    private _receipt;
    /** @private */
    private _transaction;
    /** @private */
    private _rpc;
    /** @private */
    private _loadChains;
    /** @private */
    private _resolveChain;
}
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type SwidgeOptions = import("@tetherto/wdk-wallet/protocols").SwidgeOptions;
export type SwidgeQuote = import("@tetherto/wdk-wallet/protocols").SwidgeQuote;
export type SwidgeResult = import("@tetherto/wdk-wallet/protocols").SwidgeResult;
export type SwidgeFee = import("@tetherto/wdk-wallet/protocols").SwidgeFee;
export type SwidgeStatus = import("@tetherto/wdk-wallet/protocols").SwidgeStatus;
export type SwidgeTransaction = import("@tetherto/wdk-wallet/protocols").SwidgeTransaction;
export type SwidgeProtocolConfig = import("@tetherto/wdk-wallet/protocols").SwidgeProtocolConfig;
export type SwidgeStatusOptions = import("@tetherto/wdk-wallet/protocols").SwidgeStatusOptions;
export type SwidgeStatusResult = import("@tetherto/wdk-wallet/protocols").SwidgeStatusResult;
export type SwidgeSupportedChain = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedChain;
export type SwidgeSupportedToken = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedToken;
export type SwidgeSupportedTokensOptions = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedTokensOptions;
export type LcxLibertySwidgeProtocolConfig = {
    /**
     * - LCX Liberty Swap API key (`lbk_live_...`), sent as `Authorization: Bearer`. Required unless `baseUrl` points at your own proxy that adds the key. Keep it server-side: see the README.
     */
    apiKey?: string;
    /**
     * - API origin without a trailing slash. Defaults to `https://swap-api.lcx.com`.
     */
    baseUrl?: string;
    /**
     * - Your registered integrator slug or fee-recipient address, for attribution (same-chain swaps).
     */
    integrator?: string;
    /**
     * - EVM chain id of the bound account. When omitted it is read from `provider`.
     */
    chainId?: number;
    /**
     * - JSON-RPC URL or EIP-1193 provider. Defaults to the bound account's own provider.
     */
    provider?: string | {
        request: Function;
    };
    /**
     * - Default slippage as a decimal (0.005 = 0.5%). When omitted the API default (0.5%) applies.
     */
    defaultSlippage?: number;
    /**
     * - Validity window of a same-chain swap transaction. API default 300, maximum 3600.
     */
    deadlineSecs?: number;
    /**
     * - How many tokens `getSupportedTokens` returns per chain (1-200). Defaults to 200.
     */
    tokensPerChain?: number;
    /**
     * - Per-request API timeout. Defaults to 30 000 ms.
     */
    timeoutMs?: number;
    /**
     * - How long `swidge` waits for an approval to confirm. Defaults to 180 000 ms.
     */
    receiptTimeoutMs?: number;
    /**
     * - Poll interval while waiting for an approval. Defaults to 2 000 ms.
     */
    receiptPollMs?: number;
    /**
     * - Pause after an approval confirms, before the swap is signed. Defaults to 500 ms.
     */
    approvalSettleMs?: number;
    /**
     * - A fetch implementation, for runtimes without a global one and for tests.
     */
    fetch?: typeof fetch;
    /**
     * - Maximum network fee in basis points of the input value. Fails closed.
     */
    maxNetworkFeeBps?: number | bigint;
    /**
     * - Maximum protocol fee (bridge fees on cross-chain routes) in basis points of the input. Fails closed.
     */
    maxProtocolFeeBps?: number | bigint;
};
import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols';
import LcxLibertyApiClient from './api-client.js';
