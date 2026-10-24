/** HTPR-7727 answer rule, shared by flag switches and the approval sweep.
 * @param {string} text
 * @returns {"yes" | "no" | "unclear"}
 */
function classifyAnswer(text) {
  const answer = text.normalize("NFKC").replace(/[‘’]/g, "'").toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^@(?:valentin yeo|ht product lead)\b[\s,:-]*/, "");
  const tokens = answer.match(/[\p{L}\p{N}']+|👍|👎/gu) ?? [];
  const words = tokens.join(" ");
  const answerWords = tokens.filter((token) => token !== "👍" && token !== "👎");
  if (/^(?:no|nope|nah|dont|don't|not|never|stop|hold)$/.test(answerWords[0] ?? "")
    || (answerWords[0] === "do" && answerWords[1] === "not") || words === "👎") return "no";
  if (answer.includes("?")) return "unclear";
  if (/(?:^| )(?:no|not|never|don't|dont|do not|can't|cannot|won't|wait|later|hold|stop|but|unless|until|if|maybe|perhaps|only|except|however|instead|failed|broken|bug|👎)(?: |$)/.test(words)) return "unclear";
  if (!/(?:^| )(?:yes|yep|yeah|yup|ok|okay|approve|approved|lgtm|ship it|release it|go ahead|go for it|do it|flip it|switch it|turn it on|looks good|👍)(?: |$)/.test(words)) return "unclear";
  const vocabulary = new Set("yes yep yeah yup ok okay approve approved lgtm ship it release go ahead for do flip switch turn on looks good 👍 this that the flag please pls now sure great fine works working all everyone live and thanks thank you perfect 100".split(" "));
  return tokens.every((token) => vocabulary.has(token)) ? "yes" : "unclear";
}

module.exports = { classifyAnswer };

if (require.main === module) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    console.log(JSON.stringify(JSON.parse(input).map(classifyAnswer)));
  });
}
