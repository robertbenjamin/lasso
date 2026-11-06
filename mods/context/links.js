// Links in transcript text: what each URL is, and the links of an agent's task.
// No Herdr imports, so `node links.check.mjs` can test it.

export const URL_RE = String.raw`https://(linear\.app/[a-z0-9-]+/(issue|project|document)/[A-Za-z0-9-]+|github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+|[a-z0-9-]+\.slack\.com/archives/[A-Z0-9]+/p[0-9]+)`;
export function parse(url) {
  let m;
  if ((m = /^(https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z]+-\d+))/.exec(url))) return { kind: "issue", key: m[2].toUpperCase(), url: m[1] };
  if ((m = /linear\.app\/[^/]+\/(?:project|document)\/(.+)$/.exec(url))) {
    const name = m[1].replace(/-[0-9a-f]{8,}$/, "").replace(/-/g, " ");
    return { kind: "doc", key: url, url, title: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  if ((m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url))) return { kind: "pr", key: `${m[1]}/${m[2]}#${m[3]}`.toLowerCase(), url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`, repo: m[2], number: +m[3] };
  if ((m = /\/archives\/[A-Z0-9]+\/p(\d{10})\d{6}/.exec(url))) return { kind: "slack", key: url, url, at: +m[1] * 1000 };
  return null;
}

// The task's links: its URLs, then bare ticket IDs (uppercase only: "THU-4601", not "utf-8").
export function startLinks(prompt) {
  const out = new Map();
  for (const u of prompt.match(new RegExp(URL_RE, "g")) ?? []) { const l = parse(u); if (l && !out.has(l.key)) out.set(l.key, l); }
  for (const id of prompt.match(/\b[A-Z]{2,6}-\d+\b/g) ?? []) if (!out.has(id)) out.set(id, { kind: "issue", key: id, url: null });
  return [...out.values()];
}
