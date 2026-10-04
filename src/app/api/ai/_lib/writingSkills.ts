import { renderPrompt } from "@/lib/ai/prompts/registry";
export const STRUCTURED_WRITING_STYLE = renderPrompt("structured-writing-style");

// HTPR-5587: the VERBATIM contents of Valentin's two writing skills.
// Task authoring runs these in order as its writing style. Do NOT paraphrase,
// curate, or adapt them into hand-written rules: sync the text from the skill
// files whenever they change.
export const UNSLOP_SKILL = renderPrompt("unslop-skill");

export const I_HAVE_ADHD_SKILL = renderPrompt("i-have-adhd-skill");
