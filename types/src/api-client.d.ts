export const DEFAULT_BASE_URL: "https://swap-api.lcx.com";
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
    constructor(options?: LcxLibertyApiClientOptions);
    _apiKey: string;
    _baseUrl: string;
    _timeoutMs: number;
    _retries: number;
    _fetch: typeof fetch;
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
    request(method: "GET" | "POST", path: string, options?: {
        query?: Record<string, string | number | boolean | undefined>;
        body?: unknown;
    }): Promise<any>;
    /** @private */
    private _send;
    /**
     * `POST /v1/quote`. Same-chain when `toChainId` is absent or equal to `chainId`, cross-chain otherwise.
     *
     * @param {Record<string, unknown>} body
     */
    quote(body: Record<string, unknown>): Promise<any>;
    /**
     * `POST /v1/build`: turns a quote id into the transaction to sign.
     *
     * @param {{ quoteId: string, recipient: string, deadlineSecs?: number }} body
     */
    build(body: {
        quoteId: string;
        recipient: string;
        deadlineSecs?: number;
    }): Promise<any>;
    /** `GET /v1/chains`. */
    chains(): Promise<any>;
    /**
     * `GET /v1/tokens`.
     *
     * @param {{ chainId: number, search?: string, offset?: number, limit?: number }} query
     */
    tokens(query: {
        chainId: number;
        search?: string;
        offset?: number;
        limit?: number;
    }): Promise<any>;
    /**
     * `GET /v1/bridge/transfers/{id}`: a cross-chain transfer by intent id (or transfer id).
     *
     * @param {string} id
     */
    transfer(id: string): Promise<any>;
    /**
     * `POST /v1/bridge/transfers/{intentId}/submitted`: tells the tracker the source transaction is out.
     *
     * @param {string} intentId
     * @param {string} txHash
     */
    markSubmitted(intentId: string, txHash: string): Promise<any>;
}
export type LcxLibertyApiClientOptions = {
    /**
     * - Sent as `Authorization: Bearer <apiKey>`. Leave unset only when `baseUrl` is your own proxy that adds the key.
     */
    apiKey?: string;
    /**
     * - API origin, without a trailing slash. Defaults to https://swap-api.lcx.com.
     */
    baseUrl?: string;
    /**
     * - Per-request timeout. Defaults to 30 000 ms.
     */
    timeoutMs?: number;
    /**
     * - How many times a rate-limited (429) call is sent again. Defaults to 2.
     */
    retries?: number;
    /**
     * - A fetch implementation, for runtimes without a global one and for tests.
     */
    fetch?: typeof fetch;
};
