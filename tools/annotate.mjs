// On GitHub Actions, writes a failure as an ::error:: annotation, which can be
// read through the API even when the job log cannot. Elsewhere it does nothing.
export function annotate(title, text) {
  if (!process.env.GITHUB_ACTIONS) return;
  const escape = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const tail = String(text).trimEnd().split('\n').slice(-25).join('\n');
  console.log(`::error title=${escape(title).replace(/[:,]/g, ' ')}::${escape(tail)}`);
}
