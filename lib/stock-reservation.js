import {verify} from "node:crypto";
const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAb+ThyrVTOl93V2mLUmDtL8gtt6x2Snrp6mPLis0c5jU=\n-----END PUBLIC KEY-----\n";

export function verifyReservation(token, cart) {
  try {
    const [payload, signature, extra] = String(token || "").split(".");
    if (!payload || !signature || extra || !verify(null,Buffer.from(payload,"base64url"),PUBLIC_KEY,Buffer.from(signature,"base64url"))) throw new Error();
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    const now=Math.floor(Date.now()/1000);
    if (!Number.isInteger(data.expiresAt) || data.expiresAt < now+1800 || data.expiresAt>now+2160 || data.validUntil<now || !/^[a-f0-9-]{36}$/i.test(data.id) || JSON.stringify(data.cart)!==JSON.stringify(cart)) throw new Error();
    return data;
  } catch { const error=new Error("Please begin checkout from your Pretty Little Darling cart."); error.status=401; throw error; }
}
