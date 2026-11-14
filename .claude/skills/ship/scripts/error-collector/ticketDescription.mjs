const PLAIN_LANGUAGE_TICKET_LABELS = [
  "What's wrong or wanted",
  "Who it affects",
  "Recommended course and why",
  "What Valentin must decide",
  "How to undo",
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function renderPlainLanguageTicketDescription(fields = {}) {
  const values = {
    "What's wrong or wanted": fields.whatWrongOrWanted ?? "",
    "Who it affects": fields.whoItAffects ?? "",
    "Recommended course and why": fields.recommendedCourseAndWhy ?? "",
    "What Valentin must decide": fields.whatValentinMustDecide ?? "",
    "How to undo": fields.howToUndo ?? "",
  };
  const parts = PLAIN_LANGUAGE_TICKET_LABELS.map(
    (label) => `<p><strong>${label}:</strong> ${escapeHtml(values[label])}</p>`,
  );
  return `${parts.join("")}<hr>`;
}
