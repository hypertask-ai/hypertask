const boardCases = [
  ["Manual", "h g f e d c b a", "h g f e d c b a"],
  ["Priority", "d c h b a f g e", "f a h b c d g e"],
  ["DueDate", "d b a c e h g f", "h e c a b d g f"],
  ["Size", "f a h b c d e g", "e d c h b a f g"],
  ["CreatedAt", "g e d h c b a f", "g f a b c h d e"],
  ["UpdatedAt", "h g e d c b a f", "h g f a b c d e"],
  ["SectionChangedAt", "d h c b e a f g", "f e a b c h d g"],
  ["LastCommentAt", "d h c b e a f g", "f e a b c h d g"],
  ["Assignee", "d h b c a e g f", "e c a h b d g f"],
  ["Title", "b a c d e f g h", "h g f e d c a b"],
  ["TicketNumber", "f a d b h e c g", "g c e h b d a f"],
  ["TimeInColumn", "f e a b c h d g", "d h c b e a f g"],
  ["TimeOnBoard", "g f a b c h d e", "g e d h c b a f"],
  ["TimeWithoutComment", "f e a b c h d g", "d h c b e a f g"],
];
const tableCases = [
  ["ticket", "f a d b h e c g", "g c e h b d a f"],
  ["title", "b a c d e f g h", "h g f e d c a b"],
  ["status", "a b g c h d e f", "f e d c h a b g"],
  ["assignee", "d b h a c e f g", "e a c b h d f g"],
  ["priority", "d c h b a f g e", "f a h b c d g e"],
  ["size", "f a h b c d e g", "e d c h b a f g"],
  ["due", "d b a c e h f g", "h e c a b d f g"],
  ["inColumn", "g a e f b c h d", "d h c b a e f g"],
  ["noComment", "g a e f b c h d", "d h c b a e f g"],
  ["onBoard", "g a f b c h d e", "e d h c b a f g"],
  ["time", "d e f g h b a c", "c a b d e f g h"],
  ["created", "g e d h c b a f", "f a b c h d e g"],
  ["updated", "g h e d c b a f", "g h f a b c d e"],
];
const customCases = [
  ["Text", "b a h c d e f g", "e d c a h b f g"],
  ["Number", "c d a h b e f g", "e b a h d c f g"],
  ["Date", "d b a h c e f g", "e c a h b d f g"],
  ["Select", "b d c e a h f g", "a h e c d b f g"],
  ["Checkbox", "b d h a c e f g", "a c e b d h f g"],
];
module.exports = { boardCases, tableCases, customCases };
