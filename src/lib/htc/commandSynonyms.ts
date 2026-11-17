const COMMAND_SYNONYMS: Record<string, string> = {
  darkTheme: "dark mode night mode make it dark switch to dark black background dim",
  lightTheme: "light mode day mode bright mode white background",
  createTask: "make a ticket make a new ticket add a task add an item write a task new work item",
  openAiTaskWriter: "let ai write the description ai writes the description of this task",
  assignUser: "who is working on this ticket who owns this assign this to a person owner of this work",
  assignToMe: "give this to me i will do this claim this task",
  inviteBoard: "add someone to this board invite someone let people join share this board with a colleague",
  manageMembers: "kick someone off the board remove someone from the board who is on this board",
  movetasktodifferentboard: "move it to another board move this task to a different board",
  deleteTask: "put this in the bin bin rubbish throw away get rid of this task",
  deleteBoard: "rubbish throw away get rid of this board remove board",
  toggleArchivedOnBoard: "finished tasks completed work done stuff archived work",
  setDueDate: "deadline for this task when is it due give it a date",
  GoToTrash: "open the trash deleted tasks bin",
  fullScreenAiChat: "make this full screen big chat full size",
  renameBoard: "change the board name",
  toggleBoardLayout: "show this as a list spreadsheet view",
};

export const commandSynonymText = (key: string): string => COMMAND_SYNONYMS[key] ?? "";
