const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMediaRef } = require("../src/infra/weixin/media-send");

test("buildMediaRef keeps WeChat-compatible base64-wrapped hex aes_key format", () => {
  const uploaded = {
    downloadEncryptedQueryParam: "enc-123",
    aeskey: "00112233445566778899aabbccddeeff",
  };

  const media = buildMediaRef(uploaded);

  assert.deepEqual(media, {
    encrypt_query_param: "enc-123",
    aes_key: Buffer.from(uploaded.aeskey, "utf8").toString("base64"),
    encrypt_type: 1,
  });
});
