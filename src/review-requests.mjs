/// The buttons on the review card. Each is a stable word the agent reads in
/// `{stem}_review.agent.txt`, spelled out as an instruction there; the review
/// record keeps the words in `requests`, as `group:name`. Rust holds the same
/// list (REVIEW_REQUESTS in main.rs); tools/check_frontend.mjs keeps them equal.

export const REQUEST_GROUPS = [
  {
    group: 'ask',
    label: 'Ask',
    multiple: true,
    items: [
      ['why', 'Why?'],
      ['how', 'How?'],
      ['more', 'More info'],
      ['example', 'Example'],
      ['source', 'Source?'],
      ['derive', 'Derive'],
    ],
  },
  {
    group: 'change',
    label: 'Change',
    multiple: true,
    items: [
      ['simplify', 'Simplify'],
      ['shorten', 'Shorten'],
      ['expand', 'Expand'],
      ['check', 'Check'],
      ['figure', 'Figure'],
    ],
  },
  {
    group: 'scope',
    label: 'Scope',
    multiple: false,
    items: [
      ['phrase', 'Phrase'],
      ['paragraph', 'Paragraph'],
      ['section', 'Section'],
    ],
  },
  {
    group: 'tone',
    label: 'Tone',
    multiple: false,
    items: [
      ['formal', 'More formal'],
      ['plain', 'Plainer'],
      ['jfm', 'JFM style'],
    ],
  },
];

export const REVIEW_REQUESTS = REQUEST_GROUPS.flatMap(({ group, items }) => items.map(([name]) => `${group}:${name}`));

const LABELS = Object.fromEntries(
  REQUEST_GROUPS.flatMap(({ group, items }) => items.map(([name, label]) => [`${group}:${name}`, label])),
);

/// The requests a record carries that this version knows, in menu order.
export function reviewRequests(review) {
  const asked = new Set(Array.isArray(review?.requests) ? review.requests : []);
  return REVIEW_REQUESTS.filter((request) => asked.has(request));
}

/// "Why? · How? · Paragraph": the chips as the review panel shows them.
export function requestsLabel(requests) {
  return requests.map((request) => LABELS[request] ?? request).join(' · ');
}

/// Toggle `request` in `requests`; a one-choice group swaps its choice.
export function toggleRequest(requests, request) {
  const group = request.split(':')[0];
  const single = REQUEST_GROUPS.find((entry) => entry.group === group)?.multiple === false;
  if (requests.includes(request)) return requests.filter((item) => item !== request);
  const kept = single ? requests.filter((item) => !item.startsWith(`${group}:`)) : requests;
  return REVIEW_REQUESTS.filter((item) => item === request || kept.includes(item));
}
