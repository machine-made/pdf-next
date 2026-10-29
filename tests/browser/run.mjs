// Run every browser test, each in its own process; exit non-zero if any fails.
//   node tests/browser/run.mjs [name ...]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shots } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2).map((name) => name.replace(/\.mjs$/, ''));
const tests = readdirSync(here)
  .filter((name) => name.endsWith('.mjs') && !['harness.mjs', 'run.mjs'].includes(name))
  .filter((name) => !wanted.length || wanted.includes(name.replace(/\.mjs$/, '')))
  .sort();
const failed = [];
for (const test of tests) {
  console.log(`\n# ${test}`);
  const started = Date.now();
  const { status } = spawnSync(process.execPath, [join(here, test)], { stdio: 'inherit', timeout: 180_000 });
  console.log(`# ${test}: ${status === 0 ? 'pass' : 'FAIL'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (status !== 0) failed.push(test);
}
console.log(`\n${tests.length - failed.length}/${tests.length} browser test files passed${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
if (failed.length) console.log(`screenshots: ${shots}`);
process.exit(failed.length || !tests.length ? 1 : 0);
