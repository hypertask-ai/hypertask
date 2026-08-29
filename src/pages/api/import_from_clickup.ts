// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import csvParser from "csv-parser";
import prisma from "@/lib/prisma";
import { getUniqueTaskCount } from "@/utils/controllers/tasks/create";
import {
  IPrioritiesConstants,
  PriorityConstants,
} from "@/lib/constants/constants";
import { IPriority, IUser } from "@/models/model";

interface TaskData {
  title: string;
  description: string;
  section: string;
  userId: number;
  uniqueIndex?: number;
  ticketNumber?: string;
  ranking: string;
  projectId: number;
  sectionId?: number;
  index?: number;
  priority: any;
  assignees: IUser[];
  createdByUser: any;
  tagsArray: string[];
}

interface CSVRow {
  [key: string]: string;
}

interface ResponseSummary {
  success: boolean;
  message: string;
  totalProcessed: number;
  successCount: number;
  errorCount: number;
  results: Array<{
    title: string;
    success: boolean;
    id?: number;
    error?: string;
  }>;
  totalAvailable: number;
}

interface CSVSource {
  projectId: number;
  url: string;
}


// CSV Sources mapped by projectId
const PROJECT_CSV_SOURCES: { [projectId: number]: string } = {
  374: "https://files.hypertask.app/tasks/attachments/17418774916622025-03-13T14_49_10.523Z%20ID%20As%20Workspace%20-%20CRO%20Squad%20-%20AB%20Tests%20Ideation.csv",
  377: "https://files.hypertask.app/tasks/attachments/17422311520552025-03-17T17_04_43.617Z%20ID%20As%20Workspace%20-%20CRO%20Squad%20-%20Q%201%202025%20-%20Sprint%2010%203%2017%203%2023.csv",
};

/**
 * Converts a string representation of an array into an actual array of unique tags.
 * @param tagsString - The string containing tags (e.g., "[tag1, tag2, tag3]" or "tag1, tag2").
 * @returns An array of unique, trimmed tags.
 */
export function parseArray(tagsString: string | null | undefined): string[] {
  if (
    !tagsString ||
    typeof tagsString !== "string" ||
    tagsString.trim().length === 0
  ) {
    return [];
  }

  // Remove enclosing brackets if present
  if (tagsString.startsWith("[") && tagsString.endsWith("]")) {
    tagsString = tagsString.substring(1, tagsString.length - 1);
  }

  // Split by commas, trim each tag, and filter out empty values
  const uniqueTags = new Set(
    tagsString
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
  );

  return Array.from(uniqueTags);
}

class CSVImporter {
  private projectId: number;
  private csvUrl: string;
  private tasks: TaskData[] = [];
  private csvData: CSVRow[] = [];
  private uniqueTags: string[] = [];
  private uniqueColumns: string[] = [];
  private priorityMap: any;
  private uniqueTagsDB: any[] = [];
  private uniqueColumnsDB: any[] = [];

  constructor(projectId: number, url?: string) {
    this.projectId = projectId;
    this.priorityMap = {};
    // If URL is provided, use it; otherwise, look up URL by projectId
    if (url) {
      this.csvUrl = url;
    } else {
      const defaultUrl = PROJECT_CSV_SOURCES[projectId];
      if (!defaultUrl) {
        throw new Error(
          `No default CSV URL found for project ID: ${projectId}`
        );
      }
      this.csvUrl = defaultUrl;
    }
  }

  // Static factory method to create importer from project ID
  static fromProjectId(projectId: number, url?: string): CSVImporter {
    return new CSVImporter(projectId, url);
  }

  // Fetch CSV content from the URL
  private async fetchCSV(): Promise<string> {
    console.log(`Fetching CSV from: ${this.csvUrl}`);
    const response = await fetch(this.csvUrl);
    console.log("🚀 ~ CSVImporter ~ fetchCSV ~ response:", response);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch CSV: ${response.status} ${response.statusText}`
      );
    }

    const csvText = await response.text();
    console.log(`Successfully fetched CSV (${csvText.length} bytes)`);
    return csvText;
  }

  // Parse CSV text into an array of objects
  private async parseCSVText(csvText: string): Promise<CSVRow[]> {
    return new Promise((resolve, reject) => {
      const results: CSVRow[] = [];
      const readableStream = Readable.from([csvText]);

      readableStream
        .pipe(csvParser())
        .on("data", (data) => results.push(data))
        .on("end", () => resolve(results))
        .on("error", (error) => reject(error));
    });
  }

  // Verify that the CSV row contains the required keys
  private verifyRowSchema(row: CSVRow): boolean {
    const expectedKeys = ["Task Name", "Task Content", "Status"];
    let valid = true;
    for (const key of expectedKeys) {
      if (!(key in row)) {
        console.warn(`Warning: CSV row is missing expected key: ${key}`);
        valid = false;
      }
    }
    return valid;
  }

  // Extract unique tags from the entire CSV data
  private async extractUniqueTagsAndCreate(): Promise<string[]> {
    const uniqueTagsLocal = new Set<string>();
    this.csvData.forEach((row) => {
      if (row["tags"]) {
        const tagsArray = parseArray(row["tags"]);
        tagsArray.forEach((tag) => uniqueTagsLocal.add(tag));
      }
    });

    this.uniqueTags = Array.from(uniqueTagsLocal);

    // Create tags in database if they don't exist
    await this.upsertTags();

    return this.uniqueTags;
  }

  // Create tags in the database if they don't exist
  private async upsertTags(): Promise<void> {
    // Loop through each unique tag
    for (const tag of this.uniqueTags) {
      var existingTag;

      // Check if the tag already exists in the database for the given project
      existingTag = await prisma.label.findFirst({
        where: {
          value: {
            equals: tag, // Case-insensitive search for an existing tag
            mode: "insensitive",
          },
          projectId: this.projectId,
        },
      });

      // If the tag does not exist, create a new one
      if (!existingTag) {
        existingTag = await prisma.label.create({
          data: {
            value: tag, // Store the tag value
            projectId: this.projectId, // Associate it with the current project
          },
        });
      }

      // Append the tag (existing or newly created) to the instance's uniqueTagsDB array
      this.uniqueTagsDB.push(existingTag);
    }
  }

  // Extract unique columns from the entire CSV data
  private async extractUniqueColumnsAndCreate(): Promise<string[]> {
    const uniqueColumns = new Set<string>();

    this.csvData.forEach((row) => {
      const sectionTitle = row["Status"];
      uniqueColumns.add(sectionTitle);
    });

    const sortedSections = Array.from(uniqueColumns);
    console.log(
      "🚀 ~ CSVImporter ~ extractUniqueColumnsAndCreate ~ sortedSections:",
      sortedSections
    );

    const ranks: string[] = [];

    // Generate incremental ranks like A0100, A0200, A0300
    sortedSections.forEach((_, index) => {
      const rank = `A${(index + 1) * 100}`.padEnd(5, "0"); // Ensures consistent format
      ranks.push(rank);
    });

    // Create or update sections in database
    for (let i = 0; i < sortedSections.length; i++) {
      const sectionTitle = sortedSections[i];
      const rank = ranks[i];

      const existingSection = await prisma.section.findFirst({
        where: {
          section_title: { equals: sectionTitle, mode: "insensitive" },
          projectId: this.projectId,
        },
      });
      console.log(
        "🚀 ~ CSVImporter ~ extractUniqueColumnsAndCreate ~ existingSection:",
        existingSection
      );
      var sectionDB;
      if (!existingSection) {
        sectionDB = await prisma.section.create({
          data: {
            section_title: sectionTitle,
            projectId: this.projectId,
            ranking: rank,
          },
        });
      } else {
        sectionDB = await prisma.section.update({
          where: { id: existingSection.id },
          data: { ranking: rank }, // Update rank if section exists
        });
      }
      this.uniqueColumnsDB.push(sectionDB);
    }

    return sortedSections;
  }

  // Map CSV rows to the taskData structure
  private async mapToTaskData(): Promise<TaskData[]> {
    console.log(
      `[TaskImporter] Starting mapToTaskData for projectId: ${this.projectId}`
    );
    console.log(`[TaskImporter] Processing ${this.csvData.length} CSV rows`);

    const currentProject = await prisma.project.findUnique({
      where: { id: this.projectId },
      include: {
        team: true,
      },
    });

    if (!currentProject) {
      console.error(
        `[TaskImporter] ERROR: Project with ID ${this.projectId} not found`
      );
      throw new Error(`Project with ID ${this.projectId} not found`);
    }

    console.log(
      `[TaskImporter] Found project: ${currentProject.name} (${currentProject.uniqueIdentifier})`
    );

    const taskCount = await getUniqueTaskCount(this.projectId); // Fetch count once
    console.log(`[TaskImporter] Current task count for project: ${taskCount}`);

    console.log(`[TaskImporter] Mapping CSV data to task objects...`);
    this.tasks = await Promise.all(
      this.csvData.map(async (row, index) => {
        try {
          this.verifyRowSchema(row); // Ensure row schema is correct
          const taskPriority =
            PriorityConstants.find(
              (x) =>
                x.Priority_Value.toUpperCase() === row["Priority"].toUpperCase()
            ) || PriorityConstants[0];
          console.log(
            "🚀 ~ CSVImporter ~ this.csvData.map ~ taskPriority:",
            taskPriority
          );
          const assignees = await this.getAssignees(row);
          const tagsArray = parseArray(row["tags"]);
          var createdByUser: any = { id: 1 };
          // Find section ID for the task's status
          const section = this.uniqueColumnsDB.find(
            (section) =>
              section.section_title.toLowerCase() ===
              row["Status"].toLowerCase()
          );
          if (!section) {
            console.warn(
              `[TaskImporter] WARNING: No matching section found for status "${row["Status"]}" at row ${index}. Using default section.`
            );
          } else {
            console.log(
              `[TaskImporter] Mapped status "${row["Status"]}" to section ID: ${section.id}`
            );
          }

          const defaultCreatorName = "Valentin Yeo";
          const secondaryDefault = "Rein Figuracion";
          const uniqueIndex = taskCount + index + 1;
          const ticketNumber =
            currentProject.uniqueIdentifier + "-" + uniqueIndex;
          let createdByUserDB = await prisma.user.findFirst({
            where: {
              displayName: {
                equals: row["Created By"],
                mode: "insensitive",
              },
            },
          });

          const memberCheck = await prisma.member_Team.findFirst({
            where: {
              userId: createdByUserDB?.id,
              teamId: currentProject?.teamId!,
            },
          });

          if (createdByUserDB && memberCheck) {
            if (
              row["Created By"] !== defaultCreatorName &&
              row["Created By"] !== secondaryDefault
            ) {
              createdByUserDB = await prisma.user.findFirst({
                where: {
                  displayName: {
                    equals: defaultCreatorName,
                    mode: "insensitive",
                  },
                },
              });
            }
          }

          if (createdByUserDB) createdByUser = createdByUserDB;
          console.log(
            `[TaskImporter] Created task mapping: ${ticketNumber} - "${row["Task Name"] || "Untitled Task"
            }" (Priority: ${taskPriority})`
          );

          return {
            title: row["Task Name"] || `${index}: Untitled Task `,
            description: row["Task Content"] || "",
            section: section?.section_title,
            userId: createdByUser.id, // Default user ID
            uniqueIndex: uniqueIndex, // Ensure unique numbering
            ticketNumber: ticketNumber,
            ranking: "A000",
            projectId: this.projectId,
            sectionId: section?.id,
            index: index,
            priority: taskPriority,
            createdBy: row["Created By"] || "Valentin Yeo",
            assignees,
            createdByUser,
            tagsArray,
          };
        } catch (error) {
          console.error(
            `[Row ${index}] FAILED MAPPING. Error: ${error instanceof Error ? error.message : "Unknown error"
            }`
          );
          // console.error(`[Row ${index}] Problematic row data:`, JSON.stringify(row, null, 2));
          console.error(
            `[Row ${index}] Problematic taskData:`,
            JSON.stringify(row, null, 2)
          );

          throw error; // Re-throw to bubble up
        }
      })
    );

    console.log(
      `[TaskImporter] Successfully mapped ${this.tasks.length} tasks for project ${this.projectId}`
    );
    console.log(
      `[TaskImporter] First task ticket: ${this.tasks[0]?.ticketNumber
      }, Last task ticket: ${this.tasks[this.tasks.length - 1]?.ticketNumber}`
    );

    return this.tasks;
  }
  // Create a task in the database
  private async createTask(
    taskData: TaskData
  ): Promise<{ success: boolean; json: any }> {
    try {
      console.log(
        "taskData.priority.priority_index",
        taskData.priority.priority_index
      );

      // default sectionId
      const defaultSection = await prisma.section.findFirst({
        where: {
          projectId: taskData.projectId,
        },
      });
      if (!defaultSection) throw new Error("No default section found");
      const defaultSectionId = taskData.sectionId ?? defaultSection?.id;
      // Find or create task tags
      const tagIds = [];
      if (taskData.tagsArray) {
        for (const tagName of taskData.tagsArray) {
          const tag = await prisma.label.findFirst({
            where: {
              value: { equals: tagName, mode: "insensitive" },
              projectId: this.projectId,
            },
          });

          if (tag) tagIds.push(tag.id);
        }
      }

      const task = await prisma.task.create({
        data: {
          title: taskData.title,
          description: taskData.description,
          uniqueIndex: taskData.uniqueIndex || 1,
          ticketNumber: taskData.ticketNumber,
          section: taskData.section,
          userId: taskData.userId,
          ranking: taskData.ranking,
          projectId: taskData.projectId,
          sectionId: defaultSectionId,
          createdAt: new Date(),
          updatedAt: new Date(),
          // Connect tags to the task
        },
      });

      let newdescription = convertDescriptionToHTML(taskData.description);

      await prisma.description.create({
        data: {
          content: newdescription,
          taskId: task?.id,
          creatorId: taskData.userId,
        },
      });

      prisma.drafts.create({
        data: {
          taskId: task.id,
          userId: taskData.userId,
          type: "Comment",
          projectId: taskData.projectId,
          saved: false,
        },
      });
      prisma.drafts.create({
        data: {
          taskId: task.id,
          userId: taskData.userId,
          type: "Description",
          projectId: taskData.projectId,
          saved: false,
          content: "",
        },
      });

      // now create the labels for it
      if (this.uniqueTagsDB.length > 0) {
        await prisma.taskLabel.createMany({
          data: taskData.tagsArray.map((tag) => ({
            taskId: task.id,
            labelId: this.uniqueTagsDB.find((x) => x.value === tag)?.id,
          })),
        });
      }

      if (parseInt(taskData.priority.priority_index) !== 0) {
        await prisma.priority.create({
          data: {
            taskId: task.id,
            sectionId: defaultSectionId,
            projectId: taskData.projectId,
            addedByUserId: taskData.userId,
            priority_index: parseInt(taskData.priority.priority_index),
            Priority_Value: taskData.priority.Priority_Value,
          },
        });
      }
      // ========= create task priority

      // ========= now get all the assignees, match them with existing members of that board so we can find them
      for (const assignee of taskData.assignees) {
        await prisma.assignees.create({
          data: {
            taskId: task.id,
            userId: assignee.id,
            assignerId: taskData.createdByUser.id,
          },
        });
      }
      // ========= now create the task assignees
      return {
        success: true,
        json: task,
      };
    } catch (error) {
      console.error("Error creating task:", error);
      throw error;
    }
  }

  // get all the members and assignees per task from the given CSV 'Assignee' row
  private async getAssignees(csvData: CSVRow): Promise<IUser[]> {
    const usersArray: IUser[] = [];
    const assignees = csvData["Assignee"];
    const parsedUsersStrings = parseArray(assignees);
    const currentProject = await prisma.project.findUnique({
      where: { id: this.projectId },
    });
    var checkIfUserPresent;
    for (const user_ of parsedUsersStrings) {
      let user = await prisma.user.findFirst({
        where:{
          displayName:{
            equals: 'Valentin Yeo',
            mode: "insensitive"
          }
        }
      })
      
      checkIfUserPresent = await prisma.user.findFirst({
        where: {
          displayName: {
            equals: user_,
            mode: "insensitive",
          },
        },
      });

      // Check if the user is Valentin Yeo and ensure the email is correct
      if (user_ === "Valentin Yeo" && user?.email !== "valentin@inne.io") {
        console.log("User email is incorrect for Valentin Yeo.");
        const checkIfUserPresent =  await prisma.user.findFirst({
          where: {
            email: {
              equals: "valentin@internationaldriversassociation.com"
            }
          }
        });
        if (checkIfUserPresent) {
          user = checkIfUserPresent;
        }
      }
      else if (checkIfUserPresent) {
        user = checkIfUserPresent
      }

      // const memberCheck = await prisma.member_Team.findFirst({
      //   where: {
      //     userId: user?.id,
      //     teamId: currentProject?.teamId!,
      //   },
      // });

      // if (user && memberCheck) {
      usersArray.push(user as any);
      // }
    }

    return usersArray;
  }


  // Sync the priorities from CSV with the defined constants
  private syncPrioritiesWithConstants(csvData: CSVRow[]): {
    [key: string]: number;
  } {
    const priorityMap: { [key: string]: number } = {};
    const defaultPriority: IPrioritiesConstants = PriorityConstants[0];

    csvData.forEach((row) => {
      const priorityValue = row["Priority"]?.trim().toLowerCase(); // Get the priority value from the CSV row

      if (priorityValue) {
        // Find the matching priority in PriorityConstants
        const matchingPriority = PriorityConstants.find(
          (priority) =>
            priority.Priority_Value.toLowerCase() ===
            priorityValue.toLowerCase()
        );

        console.log(`Processing priority: "${priorityValue}"`);

        switch (priorityValue) {
          case "none":
            priorityMap[priorityValue] = defaultPriority.priority_index;
            console.log(`Mapped "none" to ${defaultPriority.priority_index}`);
            break;
          case "normal":
            priorityMap[priorityValue] = PriorityConstants[3].priority_index;
            console.log(
              `Mapped "normal" to ${PriorityConstants[3].priority_index}`
            );
            break;
          case "high":
            priorityMap[priorityValue] = PriorityConstants[2].priority_index;
            console.log(
              `Mapped "high" to ${PriorityConstants[2].priority_index}`
            );
            break;
          case "urgent":
            priorityMap[priorityValue] = PriorityConstants[1].priority_index;
            console.log(
              `Mapped "urgent" to ${PriorityConstants[1].priority_index}`
            );
            break;
          default:
            console.log(
              `Priority "${priorityValue}" not in standard cases, checking for match...`
            );
            if (matchingPriority) {
              priorityMap[priorityValue] = matchingPriority.priority_index;
              console.log(
                `Found matching priority, mapped to ${matchingPriority.priority_index}`
              );
            } else {
              console.log(
                `WARNING: No matching priority found for "${priorityValue}", falling through to default case`
              );
            }
            break;
        }
      } else {
        console.log(`Skipping row with empty or undefined Priority value`);
      }
    });
    this.priorityMap = priorityMap;
    return priorityMap;
  }

  // Process the CSV data and create tasks
  public async process(limit: number = 200): Promise<ResponseSummary> {
    try {
      // 1. Fetch CSV from the URL
      const csvText = await this.fetchCSV();

      // 2. Parse the CSV text
      this.csvData = await this.parseCSVText(csvText);
      console.log(`✅ Parsed ${this.csvData.length} rows from CSV`);

      // 2.1 sync the priorities
      this.syncPrioritiesWithConstants(this.csvData);
      console.log("🔄 Synced Priorities with Constants: ", this.priorityMap);
      // 3. Extract and create unique tags
      await this.extractUniqueTagsAndCreate();
      console.log(`🔖 Found ${this.uniqueTags.length} unique tags`);

      // 4. Extract and create unique columns/sections
      await this.extractUniqueColumnsAndCreate();
      console.log(`📋 Found ${this.uniqueColumns.length} unique columns`);

      // 5. Map the CSV data to our taskData schema
      await this.mapToTaskData();
      console.log(`✅ Mapped ${this.tasks.length} tasks for import`);

      // 6. Create tasks (all or limited amount)
      const tasksToImport = limit > 0 ? this.tasks.slice(0, limit) : this.tasks;
      console.log(`🔄 Creating ${tasksToImport.length} tasks...`);

      const results: Array<{
        title: string;
        success: boolean;
        id?: number;
        error?: string;
      }> = [];
      let successCount = 0;
      let errorCount = 0;

      for (const task of tasksToImport) {
        try {
          console.log(`  ⏳ Creating task: ${task.title}`);
          const response = await this.createTask(task);
          results.push({
            title: task.title,
            success: true,
            id: response.json.id,
          });
          console.log(
            `  ✅ Created task: ID=${response.json.id}, Title=${task.title}`
          );
          successCount++;
        } catch (error) {
          results.push({
            title: task.title,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          console.log(`  ❌ Failed to create task: ${task.title} - ${error}`);
          errorCount++;
        }
      }

      // 7. Summarize the results
      return {
        success: true,
        message: `Imported ${successCount} tasks successfully. ${errorCount} tasks failed.`,
        totalProcessed: tasksToImport.length,
        successCount,
        errorCount,
        results,
        totalAvailable: this.tasks.length,
      };
    } catch (error) {
      console.error("❌ Error in process:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "An unknown error occurred",
        totalProcessed: 0,
        successCount: 0,
        errorCount: 0,
        results: [],
        totalAvailable: 0,
      };
    }
  }
}

// Default API handler
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, message: "Method not allowed" });
  }

  try {
    // Extract projectId from the request body
    const { projectId, limit = 200 } = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
    }

    // Create importer instance with the projectId
    const importer = CSVImporter.fromProjectId(parseInt(projectId.toString()));

    // Process the CSV data with specified limit
    const response = await importer.process(parseInt(limit.toString()));

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in handler:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}


function convertDescriptionToHTML(description: string): string {
  if (!description) return '';

  // Split the text into blocks by detecting two or more newlines.
  // This helps to differentiate between paragraphs and list blocks.
  const blocks: string[] = description.split(/\n{2,}/);

  const htmlBlocks: string[] = blocks.map((block: string) => {
    // Trim to remove any leading/trailing whitespace
    const trimmedBlock: string = block.trim();

    // Check if the block appears to be a bullet list (starts with a bullet)
    if (trimmedBlock.startsWith('•')) {
      // Split the block by newline, then convert each bullet line into an <li>
      const listItems: string = trimmedBlock
        .split('\n')
        .map((line: string) => line.replace(/^•\s*/, '').trim())
        .filter((item: string) => item.length > 0)
        .map((item: string) => `<li>${item}</li>`)
        .join('');
      return `<ul>${listItems}</ul>`;
    } else {
      // For non-list blocks, replace single newlines with <br> tags
      // and wrap the block in <p> tags
      const paragraphHTML: string = trimmedBlock.replace(/\n/g, '<br>');
      return `<p>${paragraphHTML}</p>`;
    }
  });

  return htmlBlocks.join('');
}
