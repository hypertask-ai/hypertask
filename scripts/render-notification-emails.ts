// Renders every notification email variant to /tmp for visual review.
// Run: npx tsx scripts/render-notification-emails.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import {
  renderNotificationEmail,
  renderDigestEmail,
} from "../src/utils/controllers/notifications/emailTemplates";

const out = "/tmp/notif-emails";
mkdirSync(out, { recursive: true });

const sender = "Valentin Yeo";
const title = "Fix onboarding drop-off";
const link = "https://app.hypertask.ai/detail/project-15/4625";
const comment =
  '<p><span data-type="mention" data-id="Abdul" data-label="name-193" class="mention">Abdul</span> can you check why the deploy failed on step 3? The log shows MISSING_KEY.</p>';

const cases: Array<[string, () => { subject: string; html: string }]> = [
  ["mention", () => renderNotificationEmail("Mention", { sender, title, link, recipient: "x@y.z", commentText: comment })],
  ["follower", () => renderNotificationEmail("Follower", { sender, title, link, recipient: "x@y.z" })],
  ["comment", () => renderNotificationEmail("Comment", { sender, title, link, recipient: "x@y.z", commentText: "<p>I think it's the new env var, the deploy log shows MISSING_KEY on step 3</p>" })],
  ["assigned", () => renderNotificationEmail("Assigned", { sender, title, link, recipient: "x@y.z" })],
  ["unassigned", () => renderNotificationEmail("Unassigned", { sender, title, link, recipient: "x@y.z" })],
  ["taskmove", () => renderNotificationEmail("TaskMove", { sender, title, link, recipient: "x@y.z", section: "Done" })],
  ["invite", () => renderNotificationEmail("Invite", { sender, title: "Marketing", link, recipient: "x@y.z" })],
  ["digest-with-mention", () => renderDigestEmail(title, link, [
    { line: "Sarah Kim commented", commentText: "<p>I think it's the new env var</p>" },
    { line: "Valentin Yeo mentioned you", commentText: comment, isMention: true, actor: sender },
    { line: "Valentin Yeo moved this task" },
  ])],
  ["digest-no-mention", () => renderDigestEmail(title, link, [
    { line: "Sarah Kim commented", commentText: "<p>I think it's the new env var</p>" },
    { line: "Valentin Yeo moved this task" },
  ])],
];

const index = [];
for (const [name, render] of cases) {
  const { subject, html } = render();
  writeFileSync(`${out}/${name}.html`, html);
  index.push({ name, subject });
  console.log(`${name}\n  subject: ${subject}`);
}

writeFileSync(
  `${out}/index.html`,
  `<!doctype html><meta charset="utf-8"><body style="font-family:Inter,sans-serif;background:#111;color:#eee;padding:20px">
  ${index
    .map(
      (i) =>
        `<h2 style="font-size:15px;margin:24px 0 4px">${i.name}</h2><div style="font-size:12px;color:#999;margin-bottom:6px">Subject: ${i.subject.replace(/</g, "&lt;")}</div><iframe src="${i.name}.html" style="width:100%;max-width:640px;height:420px;border:1px solid #444"></iframe>`
    )
    .join("")}</body>`
);
console.log(`\nwrote ${out}/index.html`);
