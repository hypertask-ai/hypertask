const stub = {
  PlainLanguageTicketError: class PlainLanguageTicketError extends Error {},
  hasPlainLanguageTicketBlock: () => true,
  assertPlainLanguageTicketBlock: () => {},
  isInternalAgentTicketBoard: () => false,
  plainLanguageTicketRefusalMessage: () => "",
};
module.exports = {
  "@/lib/flags": { isFeatureEnabled: async () => false },
  "@/lib/tickets/plainLanguageTicket.mjs": stub,
  "@/lib/tickets/plainLanguageTicket": stub,
  "@/lib/tickets/plainLanguageTicketEnforcement": stub,
  "@/lib/flags/definitions/htpr-7933-plain-language-ticket-template": {
    HTPR_7933_PLAIN_LANGUAGE_TICKET_TEMPLATE_FLAG: "htpr-7933-plain-language-ticket-template",
  },
};
