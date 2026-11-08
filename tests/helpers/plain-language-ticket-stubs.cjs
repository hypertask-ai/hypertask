module.exports = {
  "@/lib/tickets/plainLanguageTicketEnforcement": {
    PlainLanguageTicketError: class PlainLanguageTicketError extends Error {},
    hasPlainLanguageTicketBlock: () => true,
    assertPlainLanguageTicketBlock: () => {},
  },
  "@/lib/tickets/plainLanguageTicket": {
    isInternalAgentTicketBoard: () => false,
    hasPlainLanguageTicketBlock: () => true,
    plainLanguageTicketRefusalMessage: () => "",
  },
  "@/lib/flags/definitions/htpr-7933-plain-language-ticket-template": {
    HTPR_7933_PLAIN_LANGUAGE_TICKET_TEMPLATE_FLAG: "htpr-7933-plain-language-ticket-template",
  },
};
