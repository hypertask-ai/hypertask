import {
  CreateCheckoutParams,
  ICommentOption,
  IPricingSearchParams,
  IRemindAll,
  IShareTaskOption,
  ITaskOption,
  ITestimonial,
} from "@/models/model";
import { ISubscriptionPlan } from "../subscriptionPlans";
import { IAiOption, TAiModal } from "@/models/AI_Task_writer_model";
import { generalConfig } from "../configs/general.config";
import {
  aiModelOptions,
  defaultAiModelOption,
  type TModelProvider,
} from "@/lib/aiModelOptions";

export const multipleKeys = {
  65: { pressed: false },
  67: { pressed: false },
  68: { pressed: false },
  69: { pressed: false },
  71: { pressed: false },
  72: { pressed: false },
  73: { pressed: false },
  80: { pressed: false },
  82: { pressed: false },
  83: { pressed: false },
  85: { pressed: false },
  16: { pressed: false },
  51: { pressed: false },
  84: { pressed: false },
  186: { pressed: false },
};
export const gThenKeyDelay = 1000;
export const REACT_QUERY_KEYS = {
  uploadingComments: ["Uploading_Comments"],
  uploadStates: ["Uploading_States"],
  chatHistory: (sessionId: string) => ["useChatHistory: ", sessionId],
  CustomPrompt: (projectId: number) => ["useCustomPrompt: ", projectId],
};

export const DescriptionTips = (isApple: boolean) => {
  const cmdControl = isApple ? "CMD" : "CTRL";

  return [
    `${cmdControl}+J for Ai`,
  ];
};

export const CommentTips = (isApple: boolean, createComment: boolean) => {
  const cmdControl = isApple ? "CMD" : "CTRL";

  return createComment
    ? [`Tip: Hit ${cmdControl}+J for AI`]
    : [
        `Tip: Hit CTRL+M to comment`,
      ];
};

export const allTasksRoute = "/all-tasks";
export const myTasksRoute = "/my-tasks";
export const inboxRoute = "/inbox";
export const timersRoute = "/timers";
export const reminderRouterRoute = `/reminders`;
export const taskArchivesRoute = `/archived`;
export const inboxArchivesRoute = `/archived?inbox=true`;
export const starredRoute = "/starred";
export const pinnedRoute = "/pinned";
export const draftsRoute = "/drafts";
export const snippetsRoute = "/snippets";
export interface IPrioritiesConstants {
  priority_index: number;
  Priority_Value: string;
  colorCode: string;
}
export interface IEstimateConstants {
  estimate_index: number;
  estimate_value: string;
  estimate_full_value: string;
  colorCode?: string;
}

export const UrgentPriorityColor = "#F88F9C";
export const PriorityConstants: IPrioritiesConstants[] = [
  {
    priority_index: 0,
    Priority_Value: "No Priority",
    colorCode: "transparent",
  },
  {
    priority_index: 1,
    Priority_Value: "Urgent",

    colorCode: UrgentPriorityColor,
  },
  {
    priority_index: 2,
    Priority_Value: "High",
    colorCode: "#DE9D6E",
  },
  {
    priority_index: 3,
    Priority_Value: "Medium",
    colorCode: "#C2CFA5",
  },
  {
    priority_index: 4,
    Priority_Value: "Low",
    colorCode: "#95999E",
  },
];

export const EstimateConstants: IEstimateConstants[] = [
  {
    estimate_index: 0,
    estimate_value: "No size",
    estimate_full_value: "-",
    colorCode: "transparent",
  },

  {
    estimate_index: 2,
    estimate_value: "XS",
    estimate_full_value: "Extra small",
    colorCode: "#DE9D6E",
  },
  {
    estimate_index: 3,
    estimate_value: "S",
    estimate_full_value: "Small",
    colorCode: "#C2CFA5",
  },
  {
    estimate_index: 4,
    estimate_value: "M",
    colorCode: "#95999E",
    estimate_full_value: "Medium",
  },
  {
    estimate_index: 5,
    estimate_value: "L",
    colorCode: "#95999E",
    estimate_full_value: "Large",
  },
  {
    estimate_index: 6,
    estimate_value: "XL",
    colorCode: "#95999E",
    estimate_full_value: "Extra large",
  },
];

export const CommentsTQPrefixKey = "comments-for-taskId:";
export const CommentStackStatusKey = "comment-stack-for-user";
export const ScrollSettingKey = "scroll-setting-for-user";
export const GetCurrentSubtaskSettingKey = "subtask-setting-for-project";
export const GetAllManageColumnsPrefixKey = "getAllManageSections";

export const TaskDeletePrefixKey = "task-id-";
export const aiOptions: TAiModal[] = aiModelOptions;

export const defaultAiOption = defaultAiModelOption;
export type { TModelProvider };

export const defaultHour = 9;
export const defaultMinutes = 0;
export const defaultSeconds = 0;


export const createCheckoutParam = (
  teamInfo: IPricingSearchParams,
  plan: ISubscriptionPlan,
  selectedTime: number,
  mode: "Trial" | "Normal",
  returnUrl: string,
  cancelUrl: string
): CreateCheckoutParams => {
  const body = {
    teamTitle: teamInfo.teamTitle,
    googleAccountId: teamInfo.googleAccountId,
    quantity: teamInfo.totalSeats,
    stripe_customer_id: teamInfo.stripe_customer_id,
    teamId: teamInfo.teamId,
    priceId: plan.types[selectedTime].stripePriceId!,
    mode: mode,
    returnUrl: returnUrl,
    cancelUrl: cancelUrl,
  };
  return body;
};

export const defaultStripeAmountMonth: number = 2000;
export const defaultStripeAmountYear: number = 1600;

export const isSubscriptionActive = (status: string) => {
  return ["Paid", "trialing", "active"].includes(status);
};

export const testimonials: ITestimonial[] = [
  {
    name: "Marco Schache",
    role: "Vetsak Design Lead",
    content:
      "Unstructured communication between Slack, Whatsapp and Asana is down by 80% for my team of 7. Everyone actually reads and replies to their project messages now.",
    avatar: "/marco_schache.avif",
  },
  {
    name: "Rana Faizan",
    role: "66Loop CEO",
    content:
      "Auto splits are a game-changer! My 13-person team churns out hundreds of comments across 10+ projects weekly. Hypertask has become my digital home base - I practically live in it all day.",
    avatar: "/rana_faizan.avif",
  },
  {
    name: "Robin Morgan",
    role: "Indepenjend Agency",
    content:
      "Applying 'inbox zero' mindset to project boards is a game changer. We communicate more and are better organized.",
    avatar: "/robin_morgan.avif",
  },
  {
    name: "Rein Figuracion",
    role: "Product Manager - IDA",
    content:
      "Hypertask.ai has been a game-changer for our team. It keeps all our tasks organized in one place and makes it way easier to stay on track and work together. Highly recommend for any team looking to boost productivity and clarity.",
    avatar:
      "https://ui-avatars.com/api/?name=Rein+Figuracion&background=0D8ABC&color=fff",
  },
  {
    name: "Rodrigo Nask",
    role: "Growth Marketer",
    content:
      "ClickUp, Todoist, Monday... you name it, I tried it all. Some lack features and some have too many or are too slow. Hypertask gave me the capacity to DO my f*** tasks without needing to MANAGE the system or getting a degree on it. You press a key and it responds, its like magic!",
    avatar:
      "https://files.hypertask.app/tasks/attachments/1756289966053image.png",
  },
  {
    name: "Denis Sotskii",
    role: "Designer",
    content:
      "Hypertask completely streamlined our team communications. What used to take hours of back-and-forth messages now happens seamlessly in one place. The AI-powered features are incredibly helpful for keeping everyone aligned.",
    avatar:
      "https://ui-avatars.com/api/?name=Denis+Sotskii&background=0D8ABC&color=fff",
  },
  {
    name: "Lewis Mudrich",
    role: "Agency Owner",
    content:
      "Hypertask is like Asana and Superhuman had a baby. All my tasks and team communication in one tool",
    avatar: "/lewis_mudrich.avif",
  },

  {
    name: "Ellene Gladys",
    role: "Executive Assistant",
    content:
      "The AI task writer is a game changer for our product development workflow. It understands our project context perfectly and generates detailed specifications that would normally take me hours to write. Our sprint planning is now 3x faster.",
    avatar:
      "https://files.hypertask.app/tasks/attachments/1755172785582image.png",
  },
  {
    name: "Mohsin Rohani",
    role: "Freelance UX Designer",
    content:
      "As a designer, I used to spend way too much time chasing updates or rewriting the same specs in different places. With Hypertask, everything just flows. The AI actually understands context, writes tasks for me, and our whole team — design, dev, product — stays aligned without the usual back-and-forth. It’s honestly made my workday way less chaotic.",
    avatar:
      "https://files.hypertask.app/tasks/attachments/17551628715331516903412789.jpg",
  },
];

export const getCommentOptions = (
  isApple: boolean,
  isCurrentUserCreator: boolean,
  pinned: boolean,
  starred: boolean,
  creatorId?: number
): ICommentOption[] => {
  const cmdControl = isApple ? "CMD" : "CTRL";

  const canDelete =
    isCurrentUserCreator || creatorId === generalConfig.hyperAiId;
  const canEdit = isCurrentUserCreator;

  return [
    {
      title: `${pinned ? "Unpin" : "Pin"} comment`,
      type: "Pin",
      key: [cmdControl, "SHIFT", "P"],
    },
    {
      title: `${starred ? "Unstar" : "Star"} comment`,
      type: "Star",
      key: [cmdControl, "SHIFT", "S"],
    },
    {
      title: "Copy comment url",
      type: "Copy",
    },
    {
      title: "Create a new task from comment",
      type: "New",
    },
    canDelete
      ? {
          title: "Delete comment",
          type: "Delete",
          key: ["CTRL", "SHIFT", "3"],
        }
      : null,
    canEdit
      ? {
          title: "Edit comment",
          type: "Edit",
          key: [cmdControl, "ENTER"],
        }
      : null,

    {
      title: "React to comment",
      type: "React",
      key: ["R"],
    },
    {
      title: "Reply to comment",
      type: "Reply",
      key: ["ENTER"],
    },
  ].filter((option): option is ICommentOption => option !== null);
};

export const finalOnboardingScreen = {
  title: "Start saving hours every week in team communication",
  subtext:
    "Speed up project communication with keyboard-driven task management. Process notifications instantly, collaborate with full context, and achieve Inbox Zero together.",
  tiles: [
    {
      icon: "⚡",
      text: "10x Faster Task Creation",
      subtext:
        "TaskWriter AI understands your project context and creates detailed tasks in seconds, not minutes",
    },
    {
      icon: "📧",
      text: "Email-Speed Project Management",
      subtext:
        "Process project updates as fast as email with keyboard shortcuts (J/K navigation) - no more slow clicking through tasks",
    },
    {
      icon: "🎯",
      text: "Zero Context Switching",
      subtext:
        "Everything in one unified inbox - tasks, comments, updates - all accessible with lightning-fast keyboard navigation",
    },
  ],
};

export const thumbsUpEmoji = {
  id: "+1",
  name: "Thumbs Up",
  native: "👍",
  unified: "1f44d",
  keywords: [
    "+1",
    "thumbsup",
    "yes",
    "awesome",
    "good",
    "agree",
    "accept",
    "cool",
    "hand",
    "like",
  ],
  shortcodes: ":+1:",
  skin: 1,
  aliases: ["thumbsup"],
};

export const reminderDropOptions: IRemindAll[] = [
  {
    display: "Regardless",
    type: "DurationComplete",
  },
  {
    display: "If any activity",
    type: "NewNotification",
  },
];

export const shareTaskOptions: IShareTaskOption[] = [
  {
    display: "Anyone with a link",
    type: "Anyone",
  },
  {
    display: `Only invited people`,
    type: "Domain",
  },
];

export const getTaskOptions = (
  isApple: boolean,
  isArchived: boolean,
  hasNotifications: boolean,
  isKanban: boolean,
  hasSubtasks: boolean,
  hasParent: boolean,
  isStarred: boolean
): ITaskOption[] => {
  const cmdControl = isApple ? "CMD" : "CTRL";
  const altOption = isApple ? "OPT" : "ALT";
  return [
    {
      title: `${isStarred ? "Unstar" : "Star"} task`,
      type: "Star",
      key: [altOption, "S"],
    },
    {
      title: "Share task",
      type: "ShareTask",
      key: [cmdControl, "S"],
    },
    hasNotifications
      ? {
          title: "Remove inbox notifications",
          type: "RemoveNotification",
          key: ["E"],
        }
      : null,
    isKanban
      ? null
      : {
          title: "Set reminder",
          type: "Remind",
          key: ["H"],
        },
    {
      title: "Move task to inbox",
      type: "MoveInbox",
      key: [],
    },
    hasSubtasks
      ? {
          title: "Remove a sub-task",
          type: "RemoveSubtask",
          key: [],
        }
      : null,
    hasParent
      ? {
          title: "Remove as sub-task",
          type: "RemoveParent",
          key: [],
        }
      : null,
    {
      title: isArchived ? "Unarchive task" : "Archive task",
      type: "Archive",
      key: [cmdControl, "E"],
    },
    {
      title: "Follow this task",
      type: "Follow",
      key: ["F"],
    },
    {
      title: "Unfollow this task",
      type: "Unfollow",
      key: [altOption, "F"],
    },
    {
      title: "Delete task",
      type: "Delete",
      key: ["SHIFT", "3"],
    },
    {
      title: "Private share link (Title + URL)",
      type: "CopyFormattedURL",
      key: [cmdControl, ","],
    },
    {
      title: "Private share link (URL only)",
      type: "CopyURL",
      key: [cmdControl, "SHIFT", ","],
    },
    {
      title: "Public share link (Title + URL)",
      type: "CopyShareFormattedURL",
      key: [cmdControl, "."],
    },
    {
      title: "Public share link (URL only)",
      type: "CopyShareURL",
      key: [cmdControl, "SHIFT", "."],
    },
    {
      title: "Copy task ID",
      type: "CopyTaskID",
      key: [cmdControl, "I"],
    },
    {
      title: "Copy task title and ID",
      type: "CopyTaskTitleAndTicketNumber",
      key: [cmdControl, "SHIFT", altOption, ","],
    },
    {
      title: "Duplicate task",
      type: "Duplicate",
      key: [],
    },
  ].filter((option): option is ITaskOption => option !== null);
};

export const defaultDomains = ["gmail.com", "outlook.com", "yahoo.com"];

export const aiModeOptions: IAiOption[] = [
  {
    display: "AI Task Writer",
    type: "AiTaskWriter",
  },
  {
    display: "Write with AI",
    type: "WriteWithAI",
  },
];

export const TIPTAPUPDATECREATETASK = "UPDATE_TIPTAP_CREATE_TASK";

export const companySizeOptions = [
  "Just me",
  "2-5",
  "6-25",
  "26-100",
  "101-250",
  "250+",
  "Other",
];
export const companyRoleOptions = [
  "Founder or leadership team",
  "Engineering manager",
  "Software Developer",
  "Product Manager",
  "I run business, operations or customer development",
  "Freelancer",
];

export const LIKESHORTCUTEVENT = "LIKE_SHORTCUT_EVENT";
