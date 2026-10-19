/** The options or configuration passed to the module are not valid. */
export class LcxLibertyValidationError extends ValueError {
    /** @param {string} message */
    constructor(message: string);
}
/** The request asked for something LCX Liberty DEX does not offer, for example an exact-output swap. */
export class LcxLibertyUnsupportedError extends ValueError {
    /** @param {string} message */
    constructor(message: string);
}
/** The operation needs a wallet account that can sign and send transactions, and none was bound. */
export class LcxLibertyAccountRequiredError extends AccountRequiredError {
    constructor();
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
    constructor(message: string, options?: {
        code?: string;
        status?: number;
        retryAfter?: number;
        cause?: unknown;
    });
    /** @type {string | undefined} */
    code: string | undefined;
    /** @type {number | undefined} */
    status: number | undefined;
    /** @type {number | undefined} Seconds the API asked the caller to wait before retrying (429 responses). */
    retryAfter: number | undefined;
}
/** No route exists right now for the requested pair, amount or chains. */
export class LcxLibertyNoRouteError extends LcxLibertyApiError {
    constructor(message: any, options?: {});
}
/** A configured fee cap would be exceeded, or could not be evaluated (caps fail closed). */
export class LcxLibertyFeeLimitExceededError extends MaximumFeeExceededError {
    /**
     * @param {'network' | 'protocol'} kind
     * @param {number | null} actualBps - The fee in basis points of the input value, or null when it could not be evaluated.
     * @param {number} maxBps
     */
    constructor(kind: "network" | "protocol", actualBps: number | null, maxBps: number);
    kind: "network" | "protocol";
    actualBps: number;
    maxBps: number;
}
/** The route's guaranteed output is below the caller's `minAmountOut`. */
export class LcxLibertyMinAmountOutError extends SwidgeError {
    /**
     * @param {bigint} guaranteed
     * @param {bigint} required
     */
    constructor(guaranteed: bigint, required: bigint);
    guaranteed: bigint;
    required: bigint;
}
/** A transaction this module sent (an approval) was mined but reverted. */
export class LcxLibertyTransactionRevertedError extends SwidgeError {
    /** @param {string} hash */
    constructor(hash: string);
    hash: string;
}
/** A transaction this module sent (an approval) did not confirm in time. */
export class LcxLibertyTimeoutError extends SwidgeError {
    /** @param {string} hash */
    constructor(hash: string);
    hash: string;
}
/** No cross-chain transfer exists for the given swidge id. */
export class LcxLibertyUnknownSwidgeError extends NoSuchElementError {
    /** @param {string} id */
    constructor(id: string);
    id: string;
}
import { ValueError } from '@tetherto/wdk-wallet/protocols';
import { AccountRequiredError } from '@tetherto/wdk-wallet/protocols';
import { ProviderError } from '@tetherto/wdk-wallet/protocols';
import { MaximumFeeExceededError } from '@tetherto/wdk-wallet/protocols';
import { SwidgeError } from '@tetherto/wdk-wallet/protocols';
import { NoSuchElementError } from '@tetherto/wdk-wallet/protocols';
