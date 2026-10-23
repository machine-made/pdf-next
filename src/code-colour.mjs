import hljs from './vendor/highlightjs/core.min.js';
import python from './vendor/highlightjs/languages/python.min.js';
import c from './vendor/highlightjs/languages/c.min.js';
import cpp from './vendor/highlightjs/languages/cpp.min.js';
import rust from './vendor/highlightjs/languages/rust.min.js';
import fortran from './vendor/highlightjs/languages/fortran.min.js';
import julia from './vendor/highlightjs/languages/julia.min.js';
import bash from './vendor/highlightjs/languages/bash.min.js';
import shell from './vendor/highlightjs/languages/shell.min.js';
import ini from './vendor/highlightjs/languages/ini.min.js';
import yaml from './vendor/highlightjs/languages/yaml.min.js';
import json from './vendor/highlightjs/languages/json.min.js';
import latex from './vendor/highlightjs/languages/latex.min.js';
import matlab from './vendor/highlightjs/languages/matlab.min.js';
import makefile from './vendor/highlightjs/languages/makefile.min.js';
import cmake from './vendor/highlightjs/languages/cmake.min.js';
import diff from './vendor/highlightjs/languages/diff.min.js';
import javascript from './vendor/highlightjs/languages/javascript.min.js';

export const BLOCK_LIMIT = 64 * 1024;
export const DOCUMENT_LIMIT = 512 * 1024;

const GRAMMARS = { python, c, cpp, rust, fortran, julia, bash, shell, ini, yaml, json, latex, matlab, makefile, cmake, diff, javascript };
for (const [name, grammar] of Object.entries(GRAMMARS)) {
  hljs.registerLanguage(name, grammar);
}

/// The fence tags that get colour, each mapped to its grammar. The Rust side
/// keeps `language-<tag>` for exactly these tags (CODE_CLASSES).
export const TAGS = {
  python: 'python', py: 'python',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  rust: 'rust', rs: 'rust',
  fortran: 'fortran', f90: 'fortran', f95: 'fortran', f: 'fortran',
  julia: 'julia', jl: 'julia',
  bash: 'bash', sh: 'bash', zsh: 'bash',
  shell: 'shell', console: 'shell',
  toml: 'ini',
  yaml: 'yaml', yml: 'yaml',
  json: 'json',
  latex: 'latex', tex: 'latex',
  matlab: 'matlab',
  makefile: 'makefile', mk: 'makefile',
  cmake: 'cmake',
  diff: 'diff', patch: 'diff',
  javascript: 'javascript', js: 'javascript',
};

function tagOf(code) {
  for (const name of code.classList) {
    if (name.startsWith('language-')) {
      return Object.hasOwn(TAGS, name.slice(9)) ? TAGS[name.slice(9)] : null;
    }
  }
  return null;
}

/// Colour the fenced blocks of a rendered document. A block with no tag, an
/// unknown tag, or too much text stays plain; so does every block after the
/// document has used up its budget. Only markup is added: a block whose text
/// would change is left as it was.
export function colourCode(root) {
  let used = 0;
  for (const code of root.querySelectorAll('pre > code')) {
    const language = tagOf(code);
    const text = code.textContent;
    if (!language || text.length > BLOCK_LIMIT) {
      continue;
    }
    if (used >= DOCUMENT_LIMIT) {
      break;
    }
    used += text.length;
    // The line anchor the renderer put first in the block must survive.
    const anchors = [...code.querySelectorAll('.src')];
    code.innerHTML = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    code.prepend(...anchors);
    if (code.textContent !== text) {
      code.textContent = text;
      code.prepend(...anchors);
    }
  }
}
