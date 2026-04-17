export const PR_AUTOCLOSE_WARNING_MARKER =
  "<!-- workspace-dev:pr-autoclose-warning -->";

function uniqueSortedNumbers(values) {
  return [...new Set(values)].sort((first, second) => first - second);
}

export function extractIssueReferences(text) {
  return uniqueSortedNumbers(
    [...text.matchAll(/(^|[^\w])#(\d+)\b/g)].map((match) => Number(match[2])),
  );
}

export function extractAutoCloseReferences(text) {
  return uniqueSortedNumbers(
    [
      ...text.matchAll(
        /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi,
      ),
    ].map((match) => Number(match[1])),
  );
}

export function findMissingAutoCloseReferences({ title = "", body = "" }) {
  const searchableText = `${title}\n\n${body}`;
  const referencedIssues = extractIssueReferences(searchableText);
  const autoCloseIssues = new Set(extractAutoCloseReferences(searchableText));

  return referencedIssues.filter(
    (issueNumber) => !autoCloseIssues.has(issueNumber),
  );
}

export function buildAutoCloseWarningComment(missingIssueNumbers) {
  const references = missingIssueNumbers.map((issueNumber) => `#${issueNumber}`);
  const bullets = references.map((reference) => `- ${reference}`).join("\n");

  return `${PR_AUTOCLOSE_WARNING_MARKER}
This pull request references issue numbers without a GitHub auto-close keyword.

Add \`Fixes #N\`, \`Closes #N\`, or \`Resolves #N\` if merge should close the issue automatically.

Missing auto-close keywords for:
${bullets}`;
}
