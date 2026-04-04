function resolveEffectiveMyaParams({ stored = null, defaults = {} } = {}) {
  const storedModel = normalizeText(stored?.model);
  const storedEffort = normalizeText(stored?.effort);
  const source = normalizeText(stored?.source);
  const defaultModel = normalizeText(defaults?.model);
  const defaultEffort = normalizeText(defaults?.effort);
  const isUserOverride = source === "user";

  return {
    model: isUserOverride && storedModel ? storedModel : defaultModel,
    effort: isUserOverride && storedEffort ? storedEffort : defaultEffort,
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  resolveEffectiveMyaParams,
};
