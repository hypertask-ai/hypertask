import { ISection } from "@/models/model";

export const getAppliedSearchedTasks = (
  sections: ISection[],
  keyword: string
) => {
  const filteredSections = sections.map((section) => {
    return {
      ...section,
      items: (section.items ?? []).filter(
        (item) =>
          (item.title ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
          item.ticketNumber?.toLowerCase().includes(keyword.toLowerCase())
      ),
    };
  });

  return filteredSections;
};
