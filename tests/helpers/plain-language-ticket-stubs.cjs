const stub = {
  plainLanguageTicketWriterRule: () => require("../../src/lib/tickets/plainLanguageTicket.mjs").plainLanguageTicketWriterRule(),
  PlainLanguageTicketError: class PlainLanguageTicketError extends Error {},
  hasPlainLanguageTicketBlock: () => true,
  assertPlainLanguageTicketBlock: () => {},
  isInternalAgentTicketBoard: () => false,
  plainLanguageTicketRefusalMessage: () => "",
};
module.exports = {
  "@/lib/agents/defaultBrainLabel": { defaultAgentBrainLabelIds: async (_projectId, ids) => [...ids] },
  "@/lib/tickets/plainLanguageTicket.mjs": stub,
  "@/lib/tickets/plainLanguageTicket": stub,
  "@/lib/tickets/plainLanguageTicketEnforcement": stub,
  "@/lib/flags/definitions/htpr-7933-plain-language-ticket-template": {
    HTPR_7933_PLAIN_LANGUAGE_TICKET_TEMPLATE_FLAG: "htpr-7933-plain-language-ticket-template",
  },
};
