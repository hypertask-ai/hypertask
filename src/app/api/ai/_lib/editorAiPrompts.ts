import { I_HAVE_ADHD_SKILL, STRUCTURED_WRITING_STYLE, UNSLOP_SKILL } from "@/app/api/ai/_lib/writingSkills";
import { createTaskWriterSystemPromptTemplate, wrapTaskWriterContext } from "@/app/api/ai/_lib/taskWriterPrompt";
import { createBoardTemplatesBlock, type BoardTemplateContext } from "@/app/api/ai/_lib/boardTemplateContext";




export const NVC_STYLE_RULE = `- Nonviolent communication: neutral, non-blaming phrasing (observations + needs, no accusations). ONLY exception: if the user's own text or request explicitly insists on harsh/blunt language, preserve their tone - never sanitize against their will.`;


export const HOUSE_OUTPUT_STYLE = `- Bottom line up front: first sentence states the outcome/ask (pyramid principle).
- Short and scannable: 1-2 sentence paragraphs, bullets for anything multi-part, sentences <= 20 words where possible.
- Bold the load-bearing content (key terms, actions, decisions), never labels like "Issue:".
- Roughly half the word count a first draft would use.
${NVC_STYLE_RULE}
- No hashtags, no markdown asterisks in HTML surfaces.
- Never output an em dash; use a period, comma, or colon.
- No chatbot phrases: never open with "Great question", "Sure!", "Certainly", "Let me..."; never close with "I hope this helps", "Let me know if...", "Feel free to...".
- Banned words (use the plain alternative): delve, pivotal, crucial, robust, seamless(ly), leverage/utilize (use "use"), showcase, testament, landscape, tapestry, vibrant, comprehensive, streamline, facilitate (use "help"), enhance (use "improve"), additionally (use "also"), "it's important to note", "serves as"/"boasts" (use "is"/"has").
- No "not just X, but Y" framing; state the point directly.
- Cut hedging stacks ("could potentially possibly"); one hedge maximum where uncertainty is real.`;


// HTPR-5606: the authoring style for the AI Task Writer and Write with AI.
// Same two skill files as the Improve button, verbatim, plus the two rules
// that only matter when the model AUTHORS rather than rewrites: it must not
// write content the brief never gave it, and it must not drop content the
// brief did give it. A demo run on INNE-1576 invented 95 words of German and
// English subheadlines the source never contained; that is what these stop.
export const TASK_AUTHORING_STYLE = `- Apply the following two skills, in order, as your entire writing style.

=== SKILL 1: unslop ===
${UNSLOP_SKILL}

=== SKILL 2: i-have-adhd ===
${I_HAVE_ADHD_SKILL}
=== END OF SKILLS ===

<h3>SOURCE FIDELITY (outranks every rule above)</h3>
- Write ONLY what the brief and the task context give you. Never add content of your own.
- Never write copy, headlines, subheadlines, taglines, slogans, or product claims the source does not contain. Carrying over a line the source wrote is correct. Adding one it never wrote is a defect.
- Never invent metrics, dates, owners, acceptance criteria, tooling choices, reproduction steps, severities, versions, or numbers. If the source says "today", keep the word "today"; never resolve it to a calendar date.
- Never add constraints of your own (word limits, item counts, implementation approach, variation names) unless the source states them.
- Losing content is worse than padding. Every concrete item the source contains (each copy line, number, metric, link, name, step) must appear in the output, worded as the source worded it.
- A section the source does not cover gets "Not provided." at most once per section, never once per item, and never in place of content the source did give you.
- The result may be shorter than the source. It may NEVER be longer because you added content. Extra lines are allowed only when you split content the source already contains.

<h3>PRECEDENCE when rules conflict</h3>
1. The board's custom instructions. A template or section they require wins over brevity.
2. The user's explicit request in this run.
3. The two skills above.
4. Default brevity. Brevity applies WITHIN a section. It is never a reason to drop a section the template requires, or to compress a data-dense ticket into a summary.
- Priority and Size are judgements the product asks for on EVERY ticket, board instructions or not: always infer them from the brief (urgency words, impact words, effort words) and emit both spans. The same goes for any field the instructions REQUIRE (a score, a set of copy variations): fill it, never omit it and never mark it "Not provided." Infer it from the brief and keep the inference visible. "Never invent" governs facts you would present as given; it does not excuse you from a judgement the template asks you to make.

<h3>WEB WRITING (Nielsen Norman Group: people scan, they do not read)</h3>
- Every ticket is scanned top to bottom in an F pattern. Structure it with real HTML so a scan works:
  - <h2> for every section. A reader must be able to find any section from its heading alone. Sentence case, 2 to 4 words ("Hypothesis", "Test variations", "Success metrics"), never a full sentence.
  - First <p> under the title states the outcome or ask in one sentence. Nothing comes before it.
  - <ul><li> for anything with 2 or more parts. One idea per bullet. Nest for hierarchy.
  - 1 to 2 sentence paragraphs, 20 words or fewer per sentence where possible.
- Bold the load-bearing content with <strong>, never labels. Bold the words a reader's eye must land on to get the point of that line: the metric, the decision, the risk, the number, the action. Write "<strong>Shopify checkout started revenue</strong> is the primary metric", never "<strong>Metric:</strong> Shopify...".
- Never bold a generic label ("<strong>Primary:</strong>", "<strong>Note:</strong>", "<strong>Metric:</strong>"). Fold it into the sentence and bold the content: "<li>Primary metric is <strong>add-to-cart rate</strong></li>". The NAME of an enumerated item is content, not a label: "<li><strong>Variation 1</strong>: line under the add-to-cart button</li>" is correct.
- Enumerated things get enumerated. When the brief describes alternatives (test variations, options, candidates, steps), list them as <strong>Control</strong> (when a baseline exists), then <strong>Variation 1</strong>, <strong>Variation 2</strong> and so on, one bullet per item, in the order the brief gave them. Constraints that apply to all items ("both in German and English", "text-only") go in a sentence before or after the list, never as bullets inside it. A reader must be able to count the items.
- One to three bold phrases per section. If everything is bold, nothing is.
- Meaningful words first: start bullets and headings with the information-carrying word, not with "The", "This", "We will".
- Never rely on monospace or code blocks for emphasis. Code formatting is for code only.

<h3>OUTPUT HYGIENE</h3>
- Never output an em dash, anywhere, including inside quoted copy, marketing strings, and non-English text. Use a hyphen, comma, or period even when the source quotes it verbatim.
- Output a document fragment. Never wrap the result in <html>, <head>, or <body> tags, and never open with a code fence.

<h3>FINAL CHECK before you output, in this order</h3>
1) Every copy line, headline, slogan, number, date, and name in the output exists in the brief or the task context. If the brief did not write the copy, the output does not write it either. Delete what fails.
2) Priority and Size are present with their hidden spans.
3) No <strong> wraps a generic label. Alternatives are listed as Control, Variation 1, Variation 2, with no constraint bullets mixed into that list.
4) Every section has an <h2>. The first <p> states the ask.
5) No em dash anywhere. No <html>, <head>, <body>, no code fence.`;


export function createPromptForTiptapForwardSlash(
  mode = "FixSpellingAndGrammar",
  inputHtml = "",
  instruction = "",
) {
  if (mode === "FixSpellingAndGrammar") {
    return `<SYSTEM_INSTRUCTION>
          <INSTRUCTIONS>
              - **Format all responses exclusively in HTML** and Rich-Text-Format (RTF).
              - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM in your output, with the identical src and all attributes. Images are NOT text: never delete, summarize, shorten, replace, reorder, or "clean up" an <img> tag. The number of <img> tags in your output MUST equal the number in the input. Losing even one image is a critical failure.
              - Keep all links from the input intact.
              - Do **NOT** include extraneous text (e.g., "Here's the response")-just the formatted response.
              - **DO NOT** start with \`\`\`html etc. These are not readable and should be avoided.
              - **Fix spelling and grammar for the following content**
              ${NVC_STYLE_RULE}
              - This is a minimal-correction mode: only correct spelling and grammar and apply the rule above. Do NOT rewrite for brevity, structure, or style.
          </INSTRUCTIONS>
      </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "Summarize") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Summarize the following content into its key points.
            - Preserve the original meaning and every decision, date, name, and number. Do NOT add new information or answer questions.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in. Losing even one image is a critical failure.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text (e.g., "Here's the summary")-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "MakeShorter") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Make the following content shorter. Cut length significantly while preserving the meaning, tone, and every concrete fact (decisions, dates, names, numbers).
            - You are ONLY condensing existing text. DO NOT answer questions, add information, or change the meaning. Preserve all questions exactly as written.
            - Cut filler ("really", "very", "actually", "basically") and redundant phrases. Use active voice.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in. Losing even one image is a critical failure.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode.startsWith("Translate")) {
    const language = mode.includes(":")
      ? mode.split(":", 2)[1]?.trim() || "English"
      : "English";
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Translate the TEXT of the following content into ${language}. Output only the translated content, nothing else.
            - Translate text only. Do NOT translate, alter, or drop URLs, code inside <code> or <pre>, email addresses, or @mentions. Keep them exactly as-is.
            - Preserve the meaning and tone faithfully. Do NOT answer questions, summarize, shorten, or add information. Translate questions as questions.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in. Losing even one image is a critical failure.
            - Keep all links from the input intact (translate only the visible anchor text, never the href).
            - Preserve the original HTML structure (headings, lists, bold, paragraphs).
            - **DO NOT** include extraneous text (e.g., "Here's the translation")-just the translated HTML.
            - **DO NOT** start with \`\`\`html etc.
            - No hashtags, asterisks, or markdown formatting. Never output the em dash character.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "Simplify") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Simplify the following content with simpler words and shorter sentences.
            - You are ONLY rewriting existing text. DO NOT answer questions or add new information. Preserve questions as questions.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "Unslop") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Remove puffery, chatbot phrases, and AI tells. Cut filler, hedging, synonym cycling, and promotional adjectives.
            - Prefer plain speech, active voice, specific facts. Have a human tone without being cute.
            - You are ONLY rewriting existing text. DO NOT answer questions or add new information.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "ImproveReadability" || mode === "Structured") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            ${STRUCTURED_WRITING_STYLE}
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "CustomEdit" || mode.startsWith("CustomEdit:")) {
    const requestedInstruction =
      instruction.trim() || mode.slice("CustomEdit:".length).trim();
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Apply this edit instruction to the selected content only: ${requestedInstruction || "Improve the writing while preserving meaning."}
            - You are ONLY rewriting the selected content.
            - DO NOT answer the instruction as a chatbot. Output the edited content only.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes. The number of <img> tags out MUST equal the number in unless the instruction requires removing them.
            - Keep all links from the input intact unless the instruction requires changing them.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            ${HOUSE_OUTPUT_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  if (mode === "WriteContent" || mode.startsWith("WriteContent:")) {
    const requestedInstruction =
      instruction.trim() || mode.slice("WriteContent:".length).trim();
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Write new content based on this instruction: ${requestedInstruction || "Write a short useful draft."}
            - This will be pasted into a comment/description editor. Write in the user's voice.
            - Do NOT answer as a chatbot. Output only the draft HTML.
            - **DO NOT** start with \`\`\`html etc.
            ${TASK_AUTHORING_STYLE}
            - Never output the em dash character or other markdown formatting.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            - **Format all responses exclusively in HTML**.
            - Return the following content with light copy-editing only. Do NOT add, remove, or reinterpret information.
            - **IMAGE & MEDIA PRESERVATION (NON-NEGOTIABLE):** Reproduce EVERY <img>, video, iframe, audio, and embed from the input VERBATIM, with identical src and attributes.
            - Keep all links from the input intact.
            - **DO NOT** include extraneous text-just the formatted response.
            - **DO NOT** start with \`\`\`html etc.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
}


export function createKanbanSystemPrompt(mode = "default") {
  if (mode === "task_writer") {
    return createTaskWriterSystemPromptTemplate(TASK_AUTHORING_STYLE);
  }

  if (mode === "write_with_ai") {
    return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
            <h3>What you are doing</h3>
            - You are drafting a COMMENT that the user is about to post on this task. You ARE the user.
            - This is NOT a chat. Do NOT answer the person who invoked you.
            - The user's typed input is the message. Your comment MUST be about what the input says.
            - If the input is a question asking for information the user does not have, the comment IS that question: polish it and address it to the thread.
            - NEVER invent facts, statuses, dates, findings, decisions, or progress.
            - Use task context only to get names, terminology, and current state right.
            - Write in the user's voice, first person where natural.
            - Format exclusively in HTML. Do NOT start with code fences.
            - Do NOT use task structures like <h1 id="ai-generated-task-title">.
            - Use <p>, <ul>, <li>, <strong>, <em> as needed.
            ${TASK_AUTHORING_STYLE}
            - If the user asks to lengthen or extend, ignore the brevity limits and word-count target above. Keep the result scannable and follow every other style rule.
            - Keep all images, videos, iframes, embeds, and links from the input exactly.
            - For external links, add target="_blank" rel="noopener noreferrer".
            - Never set color, background-color, or border-color.
            - Output ONLY the finished comment HTML. No preamble, no sign-off, no explanation.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
  }

  return `<SYSTEM_INSTRUCTION>
            <INSTRUCTIONS>
                - Format all responses in semantic HTML.
                - No markdown wrappers.
                - Extract and preserve all links from context.
                - For external links, add target="_blank" rel="noopener noreferrer".
                - All images, videos, and iframes must be preserved.
            </INSTRUCTIONS>
        </SYSTEM_INSTRUCTION>`;
}


export function createTaskAndModelContext(args: {
  taskIds?: number[];
  modelSelected: string;
  taskDescription?: string;
  taskTitle?: string;
}) {
  const taskIds = args.taskIds ?? [];
  let context = `
    MODEL CONTEXT
    - Current LLM Model being used for response: ${args.modelSelected}

    LINK REFERENCING FOR OPENAI MODELS ONLY:
    - If you are currently an OpenAI Model, then override your previous command about Link Handling.
    - ONLY showcase the top 6 links that are very crucial to the query.
    - DO NOT reference any images or videos.
    - ONLY reference to comment links if there are no task links.
    `;

  if (taskIds.length > 1) {
    context += `
        TASK PRIORITY RELEVANCE
        Current Primary Task ID: ${taskIds[0]}
        Related Task IDs: ${taskIds.slice(1).join(", ")}

        When analyzing retrieved documents:
        - Documents from Task ID ${taskIds[0]} are from the PRIMARY/CURRENT task and should be given highest relevance
        - Documents from Task IDs ${taskIds.slice(1).join(", ")} are from RELATED tasks and should be considered as supporting context
        - Prioritize information from the primary task when there are conflicts or when making recommendations
        `;
  }

  if (
    (args.taskDescription ?? "").length > 0 &&
    (args.taskTitle ?? "").length > 0
  ) {
    context += `
        CURRENT TASK CONTEXT
        - Task Title: ${args.taskTitle}
        - Task Description: ${escapeHtml(args.taskDescription ?? "")}

        Please keep this task context in mind when generating responses and prioritize information that is relevant to achieving this specific task.
        `;
  }

  return context;
}


export function createUploadedDocumentsContext(uploadedDocuments: string) {
  return `
    <UPLOADED_DOCUMENTS>
    IMPORTANT: The user has provided uploaded documents that contain key content for this task. These documents should receive special attention and be integrated with the project context.

    UPLOADED CONTENT:
    ${uploadedDocuments}

    INTEGRATION INSTRUCTIONS:
    - Give special focus to the uploaded documents as they contain user-provided content.
    - Integrate this content with relevant project context and retrieved information.
    - Use the uploaded documents as primary source material while incorporating supporting project details.
    - Create task descriptions that leverage both uploaded content and project knowledge.
    </UPLOADED_DOCUMENTS>
    `;
}


export function createTaskWriterPromptParts(args: {
  aiMode?: string | null;
  customInstructions?: string | null;
  boardTemplates?: BoardTemplateContext[];
  modelSelected: string;
  taskIds?: number[];
  taskDescription?: string | null;
  taskTitle?: string | null;
  retrievedContext: string;
  uploadedDocumentContext?: string;
  input: string;
}) {
  const promptMode =
    args.aiMode === "AiTaskWriter"
      ? "task_writer"
      : args.aiMode === "WriteWithAI"
        ? "write_with_ai"
        : "default";

  const instructions = createKanbanSystemPrompt(promptMode);

  const reminderParts: string[] = [];
  // Board custom instructions apply in every AI entry point, WriteWithAI
  // included. A board sets policy there ("never claim disease prevention in ad
  // copy"), and policy that holds in one entry point but not another is a
  // compliance footgun, not a feature (HTPR-4356).
  const customInstructions = args.customInstructions
    ? `<CUSTOM_INSTRUCTION>${args.customInstructions}</CUSTOM_INSTRUCTION>`
    : "";
  if (customInstructions) reminderParts.push(customInstructions);
  const boardTemplates = createBoardTemplatesBlock(args.boardTemplates);
  if (boardTemplates) reminderParts.push(boardTemplates);

  const escapedDescription = escapeHtml(args.taskDescription ?? "");
  const taskModelContext = createTaskAndModelContext({
    taskIds: args.taskIds,
    modelSelected: args.modelSelected,
    taskDescription: escapedDescription,
    taskTitle: args.taskTitle ?? "",
  });
  if (taskModelContext) reminderParts.push(taskModelContext);

  if (args.uploadedDocumentContext) {
    reminderParts.push(
      createUploadedDocumentsContext(args.uploadedDocumentContext)
    );
  }

  const systemReminder = reminderParts.length
    ? "<system-reminder>\n" +
      reminderParts.join("\n") +
      "\n</system-reminder>\n\n"
    : "";
  // Retrieved ticket text is user-authored data. Keep it in the user message,
  // below the actual system instructions, so a comment cannot become policy by
  // imitating one of the prompt's XML-like delimiters.
  const retrievedContext = args.retrievedContext
    ? wrapTaskWriterContext(args.retrievedContext) + "\n\n"
    : "";
  const input = systemReminder + retrievedContext + args.input;

  return { instructions, input };
}


export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
