class TeamKeyOnlyRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "TeamKeyOnlyRefusal";
    this.code = "team_ai_key_only";
  }
}

const unrestricted = async () => ({ mode: "unrestricted" });

module.exports = {
  isPlatformAiCredential: () => false,
  resolveTeamAiFunding: unrestricted,
  resolveSideCallFunding: unrestricted,
  TeamKeyOnlyRefusal,
  keyOnlyReplacementModelKey: () => null,
  applyKeyOnlyProviderVisibility: (rows) => rows,
  aiProvidersForSavedByokKeys: () => [],
  modelOptionsForKeyOnlyTeam: (options) => options,
  embeddingAuthorization: (_decision, platformKey) => ({
    apiKey: platformKey,
    endpoint: "https://ai-gateway.vercel.sh/v1/embeddings",
    model: "openai/text-embedding-3-small",
  }),
  dictationAuthorization: (_decision, platformKey) => platformKey,
};
