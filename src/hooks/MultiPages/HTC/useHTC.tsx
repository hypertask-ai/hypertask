import { CommandGroup, ICommandList } from "@/components/Modals/commands/HTC/HTCTypes";
import { getHTCFrecencyScore } from "@/components/Modals/commands/HTC/htcFrecency";
import { getSearchTasksHandover } from "@/components/Modals/commands/HTC/searchTasksHandover";
import { commandSynonymText } from "@/lib/htc/commandSynonyms";
import { HTPR_9030_HTC_COMMAND_SYNONYMS_FLAG } from "@/lib/flags/definitions/htpr-9030-htc-command-synonyms";
import { useFlag } from "@/hooks/useFlag";
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom, frequentlyUsedHTCAton } from "@/store";
import { getCurrentUserFromCookies } from "@/utils/getCurrentUser";
import { ChangeEvent, useCallback, useEffect, useState } from "react";

const isEditDistanceOne = (left: string, right: string) => {
  if (Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    const mismatches = [...left].reduce<number[]>((indexes, character, index) => {
      if (character !== right[index]) indexes.push(index);
      return indexes;
    }, []);

    if (mismatches.length <= 1) return true;
    return mismatches.length === 2
      && mismatches[1] === mismatches[0] + 1
      && left[mismatches[0]] === right[mismatches[1]]
      && left[mismatches[1]] === right[mismatches[0]];
  }

  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let edits = 0;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) shortIndex += 1;
    else if ((edits += 1) > 1) return false;
    longIndex += 1;
  }
  return true;
};

const FILLER_WORDS = new Set([
  "a", "an", "the", "to", "my", "i", "in", "on", "off", "of", "for", "is",
  "it", "this", "that", "do", "can", "please", "how", "and", "at", "from",
  "be", "up", "im", "into", "with", "what", "where", "when", "let",
]);

const scoreToken = (command: ICommandList, token: string, synonyms: string) => {
  const name = command.name.toLowerCase();
  const keywords = command.keywords?.toLowerCase() ?? "";
  const nameWords = name.split(/[^a-z0-9]+/).filter(Boolean);
  const keywordWords = keywords.split(/[^a-z0-9]+/).filter(Boolean);

  if (name.startsWith(token)) return 100;
  if (nameWords.some((word) => word.startsWith(token))) return 80;
  if (name.includes(token)) return 60;
  if (keywordWords.some((word) => word.startsWith(token))) return 40;
  if (keywords.includes(token)) return 20;

  const synonymWords = synonyms.split(/[^a-z0-9]+/).filter(Boolean);
  if (synonymWords.some((word) => word.startsWith(token))) return 35;
  if (synonyms.includes(token)) return 18;

  if (token.length < 4) return 0;
  if (nameWords.some((word) => isEditDistanceOne(token, word))) return 10;
  if (keywordWords.some((word) => isEditDistanceOne(token, word))) return 5;
  if (synonymWords.some((word) => isEditDistanceOne(token, word))) return 4;
  return 0;
};

const useHTC = (
  allCommands_: CommandGroup[],
  emptyQueryCommands: CommandGroup[] = allCommands_,
  selectFirstOnEmpty = true,
  refreshSearchOnCommandsChange = false,
) => {
  const commandSynonyms = useFlag(HTPR_9030_HTC_COMMAND_SYNONYMS_FLAG);
  const [_currentProject] = useRecoilState(currentProjectAtom);
  const [frequentlyUsed] = useRecoilState(frequentlyUsedHTCAton);
  const currentUser = getCurrentUserFromCookies();
  const [hoveredGroup, setHoveredGroupIndex] = useState(0);
  const [currentCommandIndex, setCurrentCommandIndex] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [filterCommands, setFilteredCommands] =
    useState<CommandGroup[]>(emptyQueryCommands);
  const [selectedCommand, setSelectedCommand] = useState<null | ICommandList>(
    selectFirstOnEmpty ? emptyQueryCommands[0]?.commandLists[0] ?? null : null
  );

  const canUseCommand = useCallback((command: ICommandList) => {
    if (!command.checkOwnerShip) return true;
    return _currentProject?.team?.googleAccount?.userId === currentUser?.id;
  }, [_currentProject?.team?.googleAccount?.userId, currentUser?.id]);

  const collectResults = useCallback((searchTerm: string, synonymsEnabled: boolean) => {
    const tokens = searchTerm.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const searched = synonymsEnabled ? tokens.filter((token) => !FILLER_WORDS.has(token)) : tokens;
    if (tokens.length === 0) return emptyQueryCommands;
    if (searched.length === 0) return [{ group: "Results", commandLists: [] }];

    const seen = new Set<string>();
    const ranked = allCommands_
      .filter((group) => group.group !== "Frequently used")
      .flatMap((group) => group.commandLists)
      .filter((command) => {
        const identity = `${command.key}:${command.name}`;
        if (seen.has(identity) || !canUseCommand(command)) return false;
        seen.add(identity);
        return true;
      })
      .map((command) => {
        const synonyms = synonymsEnabled ? commandSynonymText(command.key) : "";
        const tokenScores = searched.map((token) => scoreToken(command, token, synonyms));
        if (tokenScores.some((score) => score === 0)) return null;

        const usage = frequentlyUsed[command.key];
        const frecencyBoost = getHTCFrecencyScore(
          usage?.frequency,
          usage?.lastUsedAt
        );
        return {
          command,
          score: tokenScores.reduce<number>((sum, score) => sum + score, 0) + frecencyBoost,
        };
      })
      .filter((result): result is { command: ICommandList; score: number } => result !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, 30)
      .map(({ command }) => command);
    const searchTasksHandover = getSearchTasksHandover(searchTerm);

    return [{
      group: "Results",
      commandLists: [
        ...ranked,
        ...(searchTasksHandover ? [searchTasksHandover] : []),
      ],
    }];
  }, [allCommands_, canUseCommand, emptyQueryCommands, frequentlyUsed]);

  const filterData = useCallback((searchTerm: string) => {
    if (commandSynonyms) {
      setFilteredCommands(collectResults(searchTerm, true));
      return;
    }
    setFilteredCommands(collectResults(searchTerm, false));
  }, [collectResults, commandSynonyms]);

  const onKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setKeyword(event.target.value);
    filterData(event.target.value);
  };

  const handleCommandSelect = useCallback((groupIndex: number, commandIndex: number) => {
    setCurrentCommandIndex(commandIndex);
    setHoveredGroupIndex(groupIndex);
    setSelectedCommand(filterCommands[groupIndex]?.commandLists[commandIndex] ?? null);
    document
      .getElementById(`command-${groupIndex}-${commandIndex}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [filterCommands]);

  useEffect(() => {
    setCurrentCommandIndex(0);
    setHoveredGroupIndex(0);
    setSelectedCommand(
      keyword.trim() || selectFirstOnEmpty
        ? filterCommands[0]?.commandLists[0] ?? null
        : null,
    );
  }, [filterCommands, keyword, selectFirstOnEmpty]);

  useEffect(() => {
    if (refreshSearchOnCommandsChange) filterData(keyword);
    else if (!keyword.trim()) setFilteredCommands(emptyQueryCommands);
  }, [emptyQueryCommands, filterData, keyword, refreshSearchOnCommandsChange]);

  return {
    onKeyChange,
    handleCommandSelect,
    selectedCommand,
    filterCommands,
    keyword,
    setSelectedCommand,
    setHoveredGroupIndex,
    setCurrentCommandIndex,
    currentCommandIndex,
    hoveredGroup,
  };
};

export default useHTC;
