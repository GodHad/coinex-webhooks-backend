import axios from "axios";
import crypto from 'crypto';

export async function getTimestamp() {
    // curl "https://api.bitget.com/api/v2/public/time"
    const requestTime = (await axios.get('https://api.bitget.com/api/v2/public/time')).data.data.serverTime;
    return requestTime;
}

export function sign(message: string, secretKey: string) {
    const hmac = crypto.createHmac("sha256", secretKey);
    hmac.update(message);
    return Buffer.from(hmac.digest()).toString("base64");
}

export function preHash(timestamp: string, method: string, requestPath: string, body: string) {
    return `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
}

export interface Params {
    [key: string]: string | number | boolean;
}

export function parseParamsToStr(params: Params): string {
    const sortedParams = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    const queryString = toQueryWithNoEncode(sortedParams);
    return queryString ? `?${queryString}` : "";
}

function toQueryWithNoEncode(params: [string, string | number | boolean][]): string {
    return params.map(([key, value]) => `${key}=${value}`).join("&");
}