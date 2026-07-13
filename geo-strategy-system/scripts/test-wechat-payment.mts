import assert from "node:assert/strict"
import {
  createCipheriv,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto"

const merchantKeys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
})
const wechatKeys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
})

const {
  assertWechatSignedPayload,
  assertWechatTransactionIdentity,
  createWechatAuthorization,
  decryptWechatResource,
  normalizeWechatClientIp,
  verifyWechatSignature,
  wechatH5Type,
} = await import("../src/lib/wechat-payment")

const body = JSON.stringify({ appid: "wx-test", amount: { total: 990 } })
const auth = createWechatAuthorization({
  method: "POST",
  pathWithQuery: "/v3/pay/transactions/native",
  body,
  mchId: "1115215240",
  certificateSerial: "CERT-SERIAL",
  privateKey: merchantKeys.privateKey,
  timestamp: "1722850421",
  nonce: "fixed-nonce",
})
const requestSignature = /signature="([^"]+)"/.exec(auth.authorization)?.[1]
assert.ok(requestSignature)
assert.equal(
  verify(
    "RSA-SHA256",
    Buffer.from(auth.message, "utf8"),
    merchantKeys.publicKey,
    Buffer.from(requestSignature, "base64"),
  ),
  true,
  "merchant request signature must be verifiable",
)
assert.match(auth.authorization, /mchid="1115215240"/)
assert.match(auth.authorization, /serial_no="CERT-SERIAL"/)

const callbackTimestamp = "1722850421"
const callbackNonce = "callback-nonce"
const callbackBody = JSON.stringify({ id: "event-1", event_type: "TRANSACTION.SUCCESS" })
const callbackMessage = `${callbackTimestamp}\n${callbackNonce}\n${callbackBody}\n`
const callbackSignature = sign(
  "RSA-SHA256",
  Buffer.from(callbackMessage, "utf8"),
  wechatKeys.privateKey,
).toString("base64")
assert.equal(verifyWechatSignature({
  timestamp: callbackTimestamp,
  nonce: callbackNonce,
  body: callbackBody,
  signature: callbackSignature,
  publicKey: wechatKeys.publicKey,
}), true)
assert.equal(verifyWechatSignature({
  timestamp: callbackTimestamp,
  nonce: callbackNonce,
  body: `${callbackBody} `,
  signature: callbackSignature,
  publicKey: wechatKeys.publicKey,
}), false, "mutated callback body must fail verification")

const callbackHeaders = new Headers({
  "Wechatpay-Timestamp": callbackTimestamp,
  "Wechatpay-Nonce": callbackNonce,
  "Wechatpay-Signature": callbackSignature,
  "Wechatpay-Serial": "PUB_KEY_ID_TEST",
})
assert.doesNotThrow(() => assertWechatSignedPayload({
  headers: callbackHeaders,
  body: callbackBody,
  publicKey: wechatKeys.publicKey,
  publicKeyId: "PUB_KEY_ID_TEST",
  enforceFreshTimestamp: true,
  nowSeconds: Number(callbackTimestamp),
}))
assert.throws(() => assertWechatSignedPayload({
  headers: callbackHeaders,
  body: callbackBody,
  publicKey: wechatKeys.publicKey,
  publicKeyId: "PUB_KEY_ID_OTHER",
}), /公钥不匹配/)
assert.throws(() => assertWechatSignedPayload({
  headers: callbackHeaders,
  body: callbackBody,
  publicKey: wechatKeys.publicKey,
  publicKeyId: "PUB_KEY_ID_TEST",
  enforceFreshTimestamp: true,
  nowSeconds: Number(callbackTimestamp) + 301,
}), /时间戳无效/)

const apiV3Key = "12345678901234567890123456789012"
const resourceNonce = "123456789012"
const associatedData = "transaction"
const plaintext = JSON.stringify({
  appid: "wx-test-app",
  mchid: "1115215240",
  out_trade_no: "ST-ORDER-1",
  transaction_id: "WX-TRANSACTION-1",
  trade_state: "SUCCESS",
  amount: { total: 990, currency: "CNY" },
})
const cipher = createCipheriv(
  "aes-256-gcm",
  Buffer.from(apiV3Key, "utf8"),
  Buffer.from(resourceNonce, "utf8"),
)
cipher.setAAD(Buffer.from(associatedData, "utf8"))
const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()])
const resource = {
  original_type: "transaction",
  algorithm: "AEAD_AES_256_GCM",
  ciphertext: ciphertext.toString("base64"),
  associated_data: associatedData,
  nonce: resourceNonce,
}
assert.equal(decryptWechatResource(resource, apiV3Key), plaintext)
const tampered = Buffer.from(ciphertext)
tampered[0] ^= 1
assert.throws(() => decryptWechatResource({ ...resource, ciphertext: tampered.toString("base64") }, apiV3Key))

const order = {
  id: "pay-test-1",
  outTradeNo: "ST-ORDER-1",
  userId: "user-1",
  username: "test",
  email: "test@example.com",
  packageName: "体验包",
  priceCents: 990,
  credits: 100,
  provider: "wechat" as const,
  status: "pending" as const,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}
const transaction = JSON.parse(plaintext)
assert.doesNotThrow(() => assertWechatTransactionIdentity(
  transaction,
  order,
  { appId: "wx-test-app", mchId: "1115215240" },
))
assert.throws(() => assertWechatTransactionIdentity(
  { ...transaction, amount: { total: 1, currency: "CNY" } },
  order,
  { appId: "wx-test-app", mchId: "1115215240" },
), /金额不匹配/)

assert.equal(normalizeWechatClientIp("::ffff:127.0.0.1"), "127.0.0.1")
assert.equal(normalizeWechatClientIp("unknown"), null)
assert.equal(wechatH5Type("Mozilla/5.0 (iPhone)"), "iOS")
assert.equal(wechatH5Type("Mozilla/5.0 (Linux; Android 15)"), "Android")
assert.equal(wechatH5Type("Mozilla/5.0 (Macintosh)"), "Wap")

console.log("Wechat Pay signing, callback, encryption, and identity contract passed")
