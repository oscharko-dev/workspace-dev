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

export async function runPrAutocloseWarning({ core, context, github }) {
  const pr = context.payload.pull_request;
  if (!pr) {
    core.notice("No pull request payload found; skipping.");
    return;
  }

  if (context.payload.action === "closed" && pr.merged !== true) {
    core.notice("Pull request was closed without merge; skipping.");
    return;
  }

  const missingAutoClose = findMissingAutoCloseReferences({
    title: pr.title ?? "",
    body: pr.body ?? "",
  });
  const referencedIssues = extractIssueReferences(
    `${pr.title ?? ""}\n\n${pr.body ?? ""}`,
  );

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const existingComment = comments.find(
    (comment) =>
      typeof comment.body === "string" &&
      comment.body.startsWith(PR_AUTOCLOSE_WARNING_MARKER),
  );

  if (referencedIssues.length === 0) {
    core.notice("No #N issue references found in PR title/body.");
    if (existingComment) {
      await github.rest.issues.deleteComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: existingComment.id,
      });
      core.info(`Removed resolved warning comment ${existingComment.id}.`);
    }
    return;
  }

  if (missingAutoClose.length === 0) {
    core.notice("All referenced issues include an auto-close keyword.");
    if (existingComment) {
      await github.rest.issues.deleteComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: existingComment.id,
      });
      core.info(`Removed resolved warning comment ${existingComment.id}.`);
    }
    return;
  }

  const missingList = missingAutoClose
    .map((issueNumber) => `#${issueNumber}`)
    .join(", ");
  const commentBody = buildAutoCloseWarningComment(missingAutoClose);

  if (existingComment) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existingComment.id,
      body: commentBody,
    });
    core.info(`Updated warning comment ${existingComment.id}.`);
  } else {
    const created = await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pr.number,
      body: commentBody,
    });
    core.info(`Created warning comment ${created.data.id}.`);
  }

  core.warning(
    `PR references ${missingList} without an auto-close keyword. Prefer 'Fixes #N', 'Closes #N', or 'Resolves #N'.`,
  );
}
