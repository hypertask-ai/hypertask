import type { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import {
  IBoard,
  IBoardHeader,
  INotification,
  ISplitTitle,
} from "@/models/InteractiveOnboarding/model";
import createSugarDate from "sugar/date/create";
import { EstimateConstants, PriorityConstants } from "../constants";
import { CSSProperties } from "react";
import { escapeHtml } from "@/utils/htmlEscape";

export const getBoards = (currentUser: any) => {
  const boards: IBoard[] = [
    {
      header: {
        title: "Eco Inno Marketing",
        ownerImg: tutorialUsers[0].pfp,
        memberImgs: [
          tutorialUsers[1].pfp,
          tutorialUsers[2].pfp,
          tutorialUsers[3].pfp,
          currentUser?.photoURL,
        ],
        inboxCount: 11,
      },
      sections: [
        {
          title: "To Plan 🎯",
          tasks: [
            {
              identifier: "EIM-4",
              title: "Ultimate Guide: 🌿 Environmental Certifications",
              assignee: [tutorialUsers[1].pfp],
              duedate: new Date(2024, 10, 4),
              priority: PriorityConstants[1],
              labels: ["Priority Management"],
            },
            {
              identifier: "EIM-14",
              title: "Ultimate Guide: 🌿 Environmental Certifications",
              assignee: [tutorialUsers[1].pfp],
              priority: PriorityConstants[1],
              labels: ["Priority Management"],
            },
            {
              identifier: "EIM-5",
              title: "Sustainability Metrics 💚 Dashboard Project",
              assignee: [tutorialUsers[2].pfp],
              priority: PriorityConstants[2],
              labels: ["Design"],
            },
            {
              identifier: "EIM-3",
              title: "Zero-Waste Summit ♻️ 2024",
              assignee: [tutorialUsers[0].pfp],
              size: EstimateConstants[4],
              labels: ["Client Relations"],
            },
            {
              identifier: "EIM-2",
              title: "The Green Tech 🌍 Revolution Series",
              assignee: [tutorialUsers[3].pfp],
              size: EstimateConstants[3],
              labels: ["Client Relations"],
            },
          ],
          showBottomButton: false,
        },
        {
          title: "In Production 🎨",
          tasks: [
            {
              identifier: "EIM-8",
              title: "Spring Garden Product Campaign 🌸",
              assignee: [tutorialUsers[0].pfp, tutorialUsers[3].pfp],
              duedate: new Date(2024, 10, 4),
              priority: PriorityConstants[2],
              labels: ["Client Relations", "Design"],
            },
            {
              identifier: "EIM-6",
              title: "Eco Brand Style Guide Update 🎨",
              labels: ["Client Relations", "Design"],
            },
            {
              identifier: "EIM-7",
              title: "Creating Q2 Sustainability 📊 Report Template ",
              assignee: [tutorialUsers[0].pfp, tutorialUsers[3].pfp],
              priority: PriorityConstants[1],
              labels: ["Program Management"],
            },
          ],
          showBottomButton: true,
        },
        {
          title: "Live/Running 🚀",
          tasks: [
            {
              identifier: "EIM-10",
              title: "Instagram Reels Series: Eco Myths Busted ✨",
              assignee: [tutorialUsers[3].pfp],
              priority: PriorityConstants[2],
              labels: ["Client Relations", "Design"],
            },
            {
              identifier: "EIM-11",
              title: "Biodegradable Packaging Ad Campaign 🌱",
              duedate: new Date(2024, 9, 29),
              assignee: [tutorialUsers[2].pfp],
              priority: PriorityConstants[1],
              labels: ["Design", "Content Creation"],
            },
            {
              identifier: "EIM-12",
              title: "Green Tech Podcast Sponsorships 🎧",
              assignee: [tutorialUsers[1].pfp],
              labels: ["Program Management", "Content Creation"],
            },
            {
              identifier: "EIM-19",
              title: "Winter Energy Savings Newsletter Campaign 📧",
              assignee: [tutorialUsers[0].pfp],
            },
            {
              identifier: "EIM-1",
              title: "Research Influencers for 🌱 Bio-Packaging",
              duedate: new Date(2024, 10, 6),
              size: EstimateConstants[3],
              labels: ["Design"],
            },
          ],
          showBottomButton: false,
        },
      ],
      taskPages: [
        {
          headingTitle: "Eco Brand Style Guide Update 🎨",
          descriptionContainer: `<p>Currently updating the visual identity guide for our sustainable fashion client. Design team is finalizing the new color palette that better reflects their commitment to ocean conservation. Copy team is refining the brand voice guidelines to incorporate more climate-positive messaging. Social media templates are being adapted to the new visual direction. Final review of typography and sustainable certification badge placements is underway.</p>`,
          createdAt: "23 Oct",
          creatorImg: tutorialUsers[0].pfp,
          creatorName: tutorialUsers[0].name,
          comments: [],
          taskInfo: {
            assignees: [],
            id: "EIM-6",
            status: "In Production 🎨",
            project: "Eco Inno Marketing",
            tags: ["Client Relations", "Design"],
          },
        },
        {
          headingTitle: "Creating Q2 Sustainability 📊 Report Template",
          descriptionContainer: `<p>Development of an interactive PDF template for quarterly sustainability metrics. Graphics team is designing custom icons for different environmental impact categories. Data visualization specialists are creating dynamic charts for carbon footprint tracking. Creating editable sections for client-specific sustainability achievements and goals. Adding interactive elements to showcase before/after environmental impact statistics.</p>`,
          createdAt: "23 Oct",
          creatorImg: tutorialUsers[0].pfp,
          creatorName: tutorialUsers[0].name,
          comments: [
            {
              createdBy: tutorialUsers[0].name,
              imgSrc: tutorialUsers[0].pfp,
              text: `<p><span data-type="mention" class="mention" data-id="Sarah Williams" data-label="name-42" uniqueindex="" projectid="">Sarah Williams</span> this Q2 template needs to be a significant upgrade from what we've been using. Key things I want to focus on:</p><ol class="numbered-list"><li><p>Interactivity - make sure users can click through different data views of their carbon metrics. The graphics team showed me some early icon designs that will work perfectly for this.</p></li><li><p>Section Flow:</p><ul><li><p>Executive Summary (with key wins prominently displayed)</p></li><li><p>YoY Environmental Impact Comparison</p></li><li><p>Detailed Metrics Breakdown</p></li><li><p>Client Success Stories</p></li><li><p>Forward-Looking Goals</p></li><li><p>Methodology &amp; Data Sources</p></li></ul></li><li><p>We need to make the before/after comparisons really pop - I'm thinking animated transitions when users click between time periods. Can you work with the data viz team to make this happen?</p></li></ol><p>Let's schedule a working session with the graphics team this week. Also, I want to ensure the client-editable sections are clearly marked and foolproof - we had some formatting issues in the Q1 version that we need to avoid this time around.</p>`,
              createdAt: "27 Oct",
            },
          ],
          taskInfo: {
            assignees: [
              {
                name: tutorialUsers[0].name,
                pfp: tutorialUsers[0].pfp,
              },
              {
                name: tutorialUsers[2].name,
                pfp: tutorialUsers[2].pfp,
              },
            ],
            id: "EIM-7",
            status: "In Production 🎨",
            priority: PriorityConstants[2],
            project: "Eco Inno Marketing",
            tags: ["Client Relations", "Design"],
          },
        },
        {
          headingTitle: "Winter Energy Savings Newsletter Campaign 📧",
          descriptionContainer: `<p>Weekly newsletter series running to 50k subscribers about sustainable energy practices. A/B testing different subject lines for optimal open rates is showing promising results. Engagement metrics show highest clicks on DIY insulation tips. Subscriber growth rate is at 3% week over week since launch. Cross-promotion with partner utility companies is driving additional traffic.</p>`,
          createdAt: "23 Oct",
          creatorImg: tutorialUsers[0].pfp,
          creatorName: tutorialUsers[0].name,
          comments: [],
          taskInfo: {
            assignees: [
              {
                name: tutorialUsers[0].name,
                pfp: tutorialUsers[0].pfp,
              },
            ],
            id: "EIM-9",
            status: "Live/Running 🚀",
            project: "Eco Inno Marketing",
            tags: [],
          },
        },
      ],
    },
    {
      header: {
        title: "Product Backlog",
        ownerImg: tutorialUsers[0].pfp,
        memberImgs: [
          tutorialUsers[1].pfp,
          tutorialUsers[2].pfp,
          tutorialUsers[3].pfp,
          currentUser?.photoURL,
        ],
        inboxCount: 11,
      },
      sections: [
        {
          title: "Todo",
          tasks: [
            {
              identifier: "CTBA-12",
              title: "Contact Form ✍️ Validation Enhancement",
            },
            {
              identifier: "CTBA-11",
              title: "Cookie Consent 🍪 Banner Update",
            },
            {
              identifier: "CTBA-6",
              title: "Product Filter 🔄 System Update",
            },
            {
              identifier: "CTBA-4",
              title: "Search Function 🔍 Enhancement",
            },
            {
              identifier: "CTBA-1",
              title: "User Analytics 📊 Dashboard Integration",
            },
          ],
          showBottomButton: false,
        },
        {
          title: "Doing",
          tasks: [
            {
              identifier: "CTBA-8",
              title: "Newsletter Signup ✉️ Form Optimization",
            },
            {
              identifier: "CTBA-7",
              title: "Site Security 🔒 Certification Renewal",
            },
            {
              identifier: "CTBA-2",
              title: "Website Speed ⚡ Optimization Project",
            },
          ],
          showBottomButton: false,
        },
        // {
        //   title: "Review",
        //   tasks: [
        //     {
        //       identifier: "CTBA-9",
        //       title: "404 Page 🎯 Redesign Project",
        //     },
        //     {
        //       identifier: "CTBA-5",
        //       title: "Content Loading ⌛ Performance Audit",
        //     },
        //     {
        //       identifier: "CTBA-3",
        //       title: "Mobile Navigation 📱 Redesign",
        //     },
        //     {
        //       identifier: "CTBA-10",
        //       title: "Image Gallery 🖼️ Compression System",
        //     },
        //   ],
        //   showBottomButton: false,
        // },
      ],
      taskPages: [
        {
          headingTitle: "Cookie Consent 🍪 Banner Update",
          descriptionContainer: `<p></p>`,
          createdAt: "5 Feb",
          creatorImg: tutorialUsers[3].pfp,
          creatorName: tutorialUsers[3].name,
          comments: [
            {
              createdBy: tutorialUsers[1].name,
              imgSrc: tutorialUsers[1].pfp,
              text: `<p>Try using the AI Task Writer <span data-type="mention" class="mention" data-id="Sarah Williams" data-label="name-42" uniqueindex="" projectid="">${escapeHtml(currentUser?.displayName ?? "Sarah Williams")}</span><br/></p>`,
              createdAt: "5 Feb",
            },
          ],
          taskInfo: {
            assignees: [],
            id: "CTBA-11",
            status: "Todo",
            project: "Product Backlog",
            tags: [],
          },
        },
      ],
    },
  ];

  return boards;
};

export const moveColumns: string[] = ["Todo", "Doing", "Done"];

export const getSidebarInfo = (currentUser: any): IBoardHeader[] => [
  {
    title: "Eco Inno Marketing",
    ownerImg: tutorialUsers[0].pfp,
    memberImgs: [
      tutorialUsers[1].pfp,
      tutorialUsers[2].pfp,
      tutorialUsers[3].pfp,
      currentUser?.photoURL,
    ],
    inboxCount: 11,
  },
  {
    title: "Product Backlog",
    ownerImg: tutorialUsers[0].pfp,
    memberImgs: [
      tutorialUsers[1].pfp,
      tutorialUsers[2].pfp,
      tutorialUsers[3].pfp,
      currentUser?.photoURL,
    ],
    inboxCount: 11,
  },
];

export const defaultOptions: DisplayDate[] = [
  {
    display: "tomorrow",
    date: createSugarDate("tomorrow").toISOString(),
  },
  {
    display: "next week",
    date: createSugarDate("next week").toISOString(),
  },
];

export const staticSplitTitles: ISplitTitle[] = [
  {
    title: "Important",
    count: "4",
    active: true,
  },
  {
    title: "Update",
    count: "2",
    active: false,
  },
  {
    title: "All",
    count: "5",
    active: false,
  },
];

export const sceneStates = {
  scene0: false,
  scene1: false,
  scene2: { jCount: 0, kCount: 0 },
  scene3: { tabCount: 0, shiftPressed: false },
  scene4: false,
  scene5: { ctrlPressed: false, mPressed: false },
  scene6: { ctrlPressed: false, enterPressed: false },
  scene7: false,
  scene8: false,
  scene9: false,
  scene10: false,
  scene11: false,
  scene12: { gPressed: false, iPressed: false },
  scene13: { jCount: 0, kCount: 0, eCount: 0 },
  scene14: false,
  scene15: false,
  scene16: false,
  scene17: false,
  scene18: false,
  scene19: { cmdCtrlPressed: false, bPressed: false },
  scene20: false,
  scene21: { cmdCtrlPressed: false, kPressed: false },
  scene22: false,
  scene23: false,
  scene24: false,
  scene25: false,
  scene26: { shiftPressed: 0, lPressed: 0, hPressed: 0 },
  scene27: { shiftPressed: false, jPressed: false },
  scene28: false,
  scene29: { ctrlPressed: false, dPressed: false },
  scene30: { ctrlPressed: false, jPressed: false },
  scene31: false,
  scene32: false,
  scene33: false,
};

export const multipleKeys = {
  9: { pressed: false }, // [tab]
  13: { pressed: false }, // [enter]
  66: { pressed: false }, // [b]
  68: { pressed: false }, // [d]
  72: { pressed: false }, // [h]
  73: { pressed: false }, // [i]
  74: { pressed: false }, // [j]
  75: { pressed: false }, // [k]
  76: { pressed: false }, // [l]
  77: { pressed: false }, // [m]
  190: { pressed: false }, // [.]
};

export const priorities = [
  { title: "No Priority", index: 0 },
  { title: "Urgent", index: 1 },
  { title: "High", index: 2 },
  { title: "Medium", index: 3 },
  { title: "Low", index: 4 },
];

export const getStyle = (
  urlString: string,
  size?: number,
  members?: boolean
): CSSProperties => {
  const defaultStyle: CSSProperties = {
    width: size ?? "24px",
    height: size ?? "24px",
    marginLeft: members ? "-8px" : "0px",
    borderRadius: "12px",
    overflow: "hidden",
  };

  if (urlString?.startsWith("https://framerusercontent.com"))
    return { ...defaultStyle, backgroundColor: "lightgray" };

  return { ...defaultStyle };
};

export const tutorialUsers = [
  {
    pfp: "https://lh3.googleusercontent.com/a/ACg8ocICGFbgvm6w35JpAqURr7npqCEton8qOx4sATUkJ_LoTLcPIQ=s96-c",
    name: "Robert Grant",
  },
  {
    pfp: "https://lh3.googleusercontent.com/a/ACg8ocIQSjL8crUSAD9MoCDSXeVbvaJVjIbJUoiZjD7HC1T7SfYWA88=s96-c",
    name: "Kai Chen",
  },
  {
    pfp: "https://lh3.googleusercontent.com/a/ACg8ocLimAi99Xp3FFkfoQ7dZYsa7irVJwVNev80tJUTMJ4H-zxo1I8=s96-c",
    name: "Jeannette Sanders",
  },
  {
    pfp: "https://lh3.googleusercontent.com/a/ACg8ocKfEY0itGGXyWWBLiAJIO9KG9TpOC4jEUBNxxWYEN__=s96-c",
    name: "Sarah Williams",
  },
];

export const staticNotifications: INotification[] = [
  {
    user: tutorialUsers[3].name,
    task: {
      identifier: "EIM-8",
      title: "Spring Garden Product Campaign 🌸",
      message: "Assigned To You.",
      count: 4,
    },
    date: "3 Feb",
    showDot: true,
    priority: PriorityConstants[2],
    tags: ["Client Relations", "Design"],
  },
  {
    user: tutorialUsers[0].name,
    task: {
      identifier: "EIM-10",
      title: "Instagram Reels Series: Eco Myths Busted ✨",
      message: "Assigned.",
      count: 2,
    },
    date: "6 Feb",
    showDot: true,
    priority: PriorityConstants[4],
    tags: ["Client Relations", "Design"],
  },
  {
    user: tutorialUsers[1].name,
    task: {
      identifier: "EIM-7",
      title: "Creating Q2 Sustainability 📊 Report Template",
      message: `${tutorialUsers[0].name} assigned ${tutorialUsers[3].name}`,
      count: 1,
    },
    date: "12:24 PM",
    showDot: true,
    priority: PriorityConstants[1],
    tags: ["Program Management"],
  },
  {
    user: tutorialUsers[2].name,
    task: {
      identifier: "EIM-19",
      title: "Winter Energy Savings Newsletter Campaign 📧",
      message: `${tutorialUsers[0].name} updated description.`,
      count: 1,
    },
    date: "10:15 AM",
    showDot: true,
    priority: PriorityConstants[0],
    tags: [],
  },
];
