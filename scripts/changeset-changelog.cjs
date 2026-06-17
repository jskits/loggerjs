"use strict";

let githubChangelog;

function hasGithubToken() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim() !== "");
}

function getGithubChangelog() {
  githubChangelog ??= require("@changesets/changelog-github").default;
  return githubChangelog;
}

function linkifyIssueRefs(line, options = {}) {
  const repo = options.repo;
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  if (!repo) return line;

  return line.replace(/\[.*?\]\(.*?\)|\B#([1-9]\d*)\b/g, (match, issue) =>
    issue ? `[#${issue}](${serverUrl}/${repo}/issues/${issue})` : match,
  );
}

function cleanSummary(summary) {
  return summary
    .replace(/^\s*(?:pr|pull|pull\s+request):\s*#?(\d+)/gim, "")
    .replace(/^\s*commit:\s*([^\s]+)/gim, "")
    .replace(/^\s*(?:author|user):\s*@?([^\s]+)/gim, "")
    .trim();
}

function fallbackReleaseLine(changeset, options) {
  const summary = cleanSummary(changeset.summary) || "Updated package.";
  const [firstLine, ...futureLines] = summary.split("\n").map((line) => line.trimEnd());
  const formattedLines = [
    `- ${linkifyIssueRefs(firstLine, options)}`,
    ...futureLines.map((line) => `  ${linkifyIssueRefs(line, options)}`),
  ];

  return `\n\n${formattedLines.join("\n")}`;
}

const changelogFunctions = {
  getReleaseLine: async (changeset, type, options) => {
    if (hasGithubToken()) {
      return getGithubChangelog().getReleaseLine(changeset, type, options);
    }

    return fallbackReleaseLine(changeset, options);
  },
  getDependencyReleaseLine: async (changesets, dependenciesUpdated, options) => {
    if (dependenciesUpdated.length === 0) return "";

    if (hasGithubToken()) {
      return getGithubChangelog().getDependencyReleaseLine(
        changesets,
        dependenciesUpdated,
        options,
      );
    }

    return [
      "- Updated dependencies:",
      ...dependenciesUpdated.map((dependency) => `  - ${dependency.name}@${dependency.newVersion}`),
    ].join("\n");
  },
};

module.exports = changelogFunctions;
