const SENSITIVE_FIELD_NAMES = [
  "context_token",
  "bot_token",
  "token",
  "authorization",
  "Authorization",
  "aeskey",
  "aes_key",
  "upload_param",
  "encrypted_query_param",
];

const JSON_FIELD_PATTERN = new RegExp(
  `"(${SENSITIVE_FIELD_NAMES.join("|")})"\\s*:\\s*"[^"]*"`,
  "g"
);

const QUERY_FIELD_PATTERN = new RegExp(
  `([?&](?:${SENSITIVE_FIELD_NAMES.join("|")})=)[^&\\s]+`,
  "g"
);

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
const DEFAULT_MAX_LEN = 800;

function truncateText(text, maxLen = DEFAULT_MAX_LEN) {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}…(truncated, totalLen=${text.length})`;
}

function redactSensitiveText(input, maxLen = DEFAULT_MAX_LEN) {
  const text = typeof input === "string" ? input : String(input || "");
  if (!text) {
    return "";
  }

  const redacted = text
    .replace(JSON_FIELD_PATTERN, '"$1":"<redacted>"')
    .replace(QUERY_FIELD_PATTERN, "$1<redacted>")
    .replace(BEARER_PATTERN, "Bearer <redacted>");

  return truncateText(redacted, maxLen);
}

module.exports = {
  redactSensitiveText,
};
