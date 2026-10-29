# pdf-next

*pdf-next by machine-made.*

A small, fast PDF, image and markdown viewer that **reloads the moment the file changes** —
built for the LaTeX and Typst compile loop, where you rebuild and want to see the result
without touching anything.

[![CI](https://github.com/machine-made/pdf-next/actions/workflows/ci.yml/badge.svg)](https://github.com/machine-made/pdf-next/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub](https://img.shields.io/badge/github-pdf--next-blue)](https://github.com/machine-made/pdf-next)

It is the desktop sibling of [vscode-pdf Next](https://github.com/machine-made/vscode-pdf-next)
and shares its rendering approach: Mozilla PDF.js (`pdfjs-dist@6.3.289`) parsing in a
real worker thread, dark reading modes that recolour pages instead of filtering them, and reload
that survives a build deleting and recreating the file mid-compile.

## What it does

- **Sharp rendering on high-density displays.** Pages refresh when display density changes.
  At high zoom, detail rendering skips off-screen drawing operations to reduce scrolling work.

- **Watches your file, on by default.** Rebuild the PDF and the view updates within a second,
  keeping your page, scroll position and zoom. The interval is in the toolbar — 1s, 2s, 3s, or
  off. If the build deletes the file first, the last render stays on screen and a red dot
  appears until the new file lands.
- **Never shows a half-written file.** A build rewrites a PDF over hundreds of milliseconds and
  the file's metadata changes the instant it starts, so a naive watcher reloads garbage. Before
  reloading, pdf-next checks the file is complete: on Windows the writer normally holds an
  exclusive lock, so simply opening it fails; on macOS and Linux nothing stops you reading a
  partial file, so PDFs are also checked for their `%%EOF` trailer. If it is not ready, the
  reload waits for the next tick.
- **Leaves the PDF available to build tools.** The viewer keeps PDF bytes in memory and
  closes the source file after reading. You can overwrite, replace, or delete it while
  it is displayed. Release smoke tests check those operations in the running viewer.
- **Fits the window to the document.** Open a paper and the window becomes the size of the page
  itself, centred; open a wide figure and the window is wide. It only happens when you open a
  file — rebuilds never move your window. With no file open, it stays a small drop target.
- **Trims the window to the page** when you open a file. A PDF or figure comes up at 100% and
  the window hugs it — no band of empty desk on a big screen. A figure larger than the screen,
  such as a plot saved at 400 dpi, opens whole: it is scaled down until it fits. A PDF page
  taller than the monitor clamps to the screen and scrolls. Rebuilds and tab switches leave the window where it is.
  `Ctrl+Shift+F` keeps the window following the content after that.
- **Dock to any half of the screen** — five toolbar buttons, or `Ctrl+Shift+←` / `→` / `↑` /
  `↓`, fill the left, right, top or bottom half, so the document takes one half and your
  editor keeps the other. Any dock switches to fit-width, because a half-screen window is for
  reading in, and fitting a whole page into one just shrinks the text. The center button (or
  `Ctrl+Shift+Enter`, or pressing the same edge again) undocks: the window hugs the page at
  100%, centred. Your place in the document survives every move.
- **Fit the window to the content** with `Ctrl+Shift+F` or the toolbar button — the other
  direction from everything above. Set a figure to the size you want it and the window comes to
  the picture: no padding, no border of background, the frame exactly on the edges. It stays on,
  so zooming out brings the window in with it and zooming in pushes it back out, up to the size
  of your screen. Choosing a fit preset from the zoom menu turns it off again, because fitting
  the content to the window is the opposite instruction.
- **Tabs, without the memory.** Open several files and they line up in a strip; `←` / `→`,
  `Ctrl+Tab`, `Ctrl+1`…`9` or the mouse wheel over the strip move between them, `Ctrl+W` closes one. A tab is a path, not a
  loaded document — only the file you are looking at is in memory, so six open papers cost what
  one costs, and a background tab is read fresh from disk when you come back to it rather than
  going stale. Switching costs a re-parse, against a worker that is already warm.
- **Panes, like a terminal.** `Ctrl+Shift+D` splits the window to the right, `Ctrl+Shift+E`
  splits it down, and the pane menu in the toolbar does the same. Each pane has its own tabs:
  drag a tab to another pane, to a pane's edge to split it again, or onto a pane's tab strip to
  merge; drag the line between panes to resize. `Ctrl+Alt+←/→/↑/↓` moves between panes. Any file
  kind works in any pane. The pane you click is the live one, with reviews, editing, find and
  zoom; the others keep a copy of where you left them, and a Markdown copy follows its file as
  it changes. The layout is saved with the session; with one pane left, the plain tab strip
  comes back.
- **Walk a folder of figures.** With a single file open, `←` / `→` (or the toolbar arrows) step
  through every image next to it, in reading order — `fig2` before `fig10`, not after it. The
  toolbar shows your position, and the window stays where it is instead of resizing on every
  press; each figure fills it whole (Fit page), larger or smaller than 100%. A rotate button
  next to the arrows turns the picture a quarter turn clockwise per press; the next file comes
  up upright again.
- **Delete the file you are looking at.** `Delete` (`⌘⌫` on macOS) asks first, then moves the
  file to the Recycle Bin, the Trash, or your desktop's trash, where it can be restored. A
  folder with no Recycle Bin — a network share, or WSL's `\\wsl.localhost` — asks whether to
  delete the file permanently instead. In a folder of figures the next one opens; any other
  file closes its tab.
- **PDF, images and markdown.** `.pdf`, plus `.png`, `.jpg`, `.webp` and `.avif`, plus `.md`.
  Images zoom too, with the same control and keys as a PDF.
- **Markdown, rendered or raw.** A `.md` opens as a typeset reading column — GitHub-style
  tables, task lists, footnotes and strikethrough included — parsed by
  [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark) in Rust and sanitized by
  [ammonia](https://github.com/rust-ammonia/ammonia) before the HTML ever reaches the window,
  so a hostile file cannot script anything. `Ctrl+U` with no selection (or the toolbar button) flips to the raw
  text and back; zoom reflows the text rather than scaling a bitmap. Edit the file and the
  view reloads within a second, keeping your scroll position — the same watch loop as PDFs.
- **Equations, typeset.** `$…$`, `$$…$$` and a fenced block marked `math` are TeX, turned into
  MathML by [math-core](https://github.com/tmke8/math-core) in the same Rust pass and set in
  New Computer Modern Math — no JavaScript math engine, nothing fetched, and the MathML meets
  the same sanitizer as the prose. Numbered environments, `\label` and `\eqref`, `\newcommand`
  across a file, and `split` work. An equation that fails to convert, calls a macro in a loop,
  or exceeds the rendering limits is shown as escaped TeX source; an unknown command is marked in
  red and the rest of the equation still renders. A `\eqref` to an equation further down the file
  shows `(??)`.
- **Markdown typography:** Rendered text is set in Latin Modern Roman at 17 px on a 38 em measure, hyphenated with `text-wrap: pretty` for natural word breaks. Toolbar menus change the font (Latin Modern, the machine-made faces Weft, Sans and Heddle, Serif, Sans, Mono, and the five Monaspace faces Neon, Argon, Xenon, Radon and Krypton), the text size (14 px to 48 px) and the column width (a number of pixels, or 100%; 720 px by default); each choice is remembered. Zoom reflows the text rather than scaling it. The mouse wheel over any toolbar menu (zoom, page view, font, size, width, panes, reload interval) steps through its choices without opening it; over the zoom menu or its buttons it zooms.
- **Coloured code:** Fenced code blocks tagged python, c, cpp, rust, fortran, julia, bash, shell, toml, yaml, json, latex, matlab, makefile, cmake, diff or javascript (and their usual short tags, such as `py`, `rs`, `f90`, `sh`, `tex`, `yml`) are coloured by highlight.js in all four colour modes (clear, night, invert, sepia); the raw Markdown view stays plain. An untagged or unknown block stays plain, and a block over 64 KiB, or code past 512 KiB in one file, is left uncoloured.
- **Page view:** The page-view menu in the toolbar shows a PDF as Single page or Two pages (the cover alone, then pairs, as in a printed book), and Markdown as Continuous, Single page or Two pages. Markdown pages are A4 boxes with 25 mm margins that take whole blocks: a heading moves to the next page with the block after it, and a block taller than a page keeps a page of its own, grown to fit, because paragraphs, tables, code and equations are not split. Reviews, find and line links work the same in every view, and each page box prints on its own sheet. The choice is remembered per kind.
- **Ask and the Review panel.** With the Review panel closed, selected text is for copying (`Ctrl+C` or the right-click menu). Open the panel and a selection becomes the review tool: create a request for the agent. Improve carries an instruction; Polish (wording only, same meaning), Shorten, Expand, Check (verify a fact, number or equation), Make bold, Make italic and Delete say what to do by themselves, with an optional note. A review keeps the original quote, PDF page and context, stable ID, action, status and resolution in `{stem}_review.json` (`paper.pdf` → `paper_review.json`). Delete means “remove this passage from the source”; saving a request never changes a PDF or source file. Improve carries its instruction in `comment`. The Review panel shows each request and tracks it through open, applied and resolved. An agent records a successful source edit and build as applied; you verify the recompiled PDF before resolving it. `Ctrl+Shift+R` toggles the panel. − and + in the panel head change the comment size. Esc, the × or Cancel closes the review box without saving, and so does a click outside it while it is still empty. Remove review takes effect at once and shows Undo for ten seconds; `Ctrl+Z` undoes the last removal too, and the review comes back with the same ID. When the file changes under a review, as it does while an agent works through the list, each open review is found again by its quote and the text around it, even after nearby edits; pdf-next then rewrites that review's lines and context in the sidecar, so the record follows the text. A quote that was itself reworded is marked, with a dashed line, between its old neighbours. Reattach pins a review to other text: select the text and click Reattach, or click Reattach and then select it (Esc cancels). Not available for images.
- **Checking what the agent did.** A Markdown review keeps the source of its paragraph as it was (`before`). When the agent marks it applied, the Review panel shows a word-by-word before/after of that passage: removed words struck out, new ones highlighted, long unchanged stretches folded to …. A passage that is gone shows its old text as removed. Resolve closes the item; Reopen asks for a short note on what is still wrong, adds it to the comment and sends the item back to the agent. The Ask buttons (Why?, How?, More info, Example, Source?, Derive) mean “this text is unclear, rewrite it so it answers this”, so their result is read in the same before/after. When the agent needs you to decide something, it asks back: the item turns `question`, stands out with a ? on its highlight and in the panel, whose head counts the questions, and shows the question with a reply field. Send (or Enter) saves your answer in `reply` and puts the item back to open for the agent. The Status filter has Question.
- **Copy the path or the name** from the two buttons after zoom: the full path as a person would type it, or just the file name.
- **Reduce a PDF** with the toolbar button next to Print. A pure-Rust pass (no Ghostscript) writes `{stem}_reduced.pdf` beside the original when it can shrink the file; the original stays untouched and the smaller copy opens as a tab.
- **Changed blocks light up on reload:** When a Markdown file rewrites, changed and new paragraphs, headings, list items, tables and equations fade from a highlight over a few seconds. The comparison is by content: adding a paragraph marks only that one. Scroll position is kept.
- **Links go where you would expect.** A `#heading` or footnote scrolls; a web link, in a
  markdown file or a PDF, opens in your browser; a relative link — `[notes](other.md)`, `[fig](fig1.png)`, the paper it
  cites — opens as a new tab, if it is a kind pdf-next shows. Nothing ever navigates the
  viewer itself.
- **Local images in Markdown.** `![](fig.png)` shows an image file on your disk, by a relative
  or absolute path, up to 64 MiB, and the view reloads when the image changes. Web, `data:`,
  `file:` and network (UNC) sources are not loaded, and neither is a link that resolves to a
  Windows network share. A network file system mounted as an ordinary folder looks local and is
  read like one. A refused image shows its alt text in a marked box.
- **Follows your system dark mode**, and can recolour PDF pages themselves. The mode button
  cycles Clear → Night → Invert → Sepia, so plain white pages are always one press away;
  Shift+click it to jump straight back to Clear from anywhere.
- **Text search** with match counts, powered by PDF.js.
- **Opens at a page, or at a figure.** `--page 12`, `--find "Figure 3"` and `--dest results`
  say where to land, and the same thing can be written on the path the way a PDF link is —
  `paper.pdf#page=7&search=wake`. For Markdown, `--line 42` or `#line=42` aim at the first block at or after that line; `--find` and `#search=` also work on Markdown. A file already open is aimed rather than opened twice, so a
  running window jumps to the page you asked for; `--no-focus` hands a file over without
  raising the window. The `opened` line prints the fragment that was understood (including `line=N` for Markdown), which is what
  lets a script — or an agent — check rather than assume.
- **Print with `Ctrl+P`**, to the system's own dialog — the real one, with your printer list,
  page range, copies, duplex, paper size and scaling. pdf-next adds no print settings of its
  own: it lays the document out for paper, then hands the window to macOS's print panel, the
  GTK dialog, or WebView2's print preview, whichever the machine has. A PDF is re-rendered at
  150 dpi on white, so what comes out is the page and not the screen — no toolbar, no dark
  mode, no window chrome — and an A4 paper prints at true size on A4. Markdown reflows across
  sheets as text, and an image gets a sheet to itself. A document whose pages are not all the
  same size follows the first one, as it does in every other viewer. If the machine has nothing
  to print to — no printer, or a stopped print service — it says so rather than opening nothing.
- **The title says which build you are running** — `paper.pdf — pdf-next 0.16.0` — so a bug report
  can name a version without hunting for an about box.
- **Tells you when there is a newer version.** A few seconds after launch the app asks
  GitHub for the latest release, once; if it is newer, the last toolbar button lights up and a
  press fetches the installer for your system — `.exe`, `.dmg` or `.AppImage` — in your
  browser, from the repo's own Releases page. Pressing the button checks again on demand.
  Nothing polls: that one request at launch is the only network access the app makes on its
  own, downloads only ever happen on a press, and GitHub is the only host it can reach.
- **Figures in Markdown.** An image alone on its line is a figure: its alt text becomes the
  caption, numbered Figure 1, 2, … down the file. Size and place one in the Markdown itself with the
  attribute syntax Pandoc and Quarto use: `![Wake behind the cylinder](wake.png){width=60%}`,
  `{width=8cm}` (also `mm`, `in`, `pt`, `px`), `{height=300}`, and `.left`, `.right` or `.center`
  (inside a line of text, `.left` and `.right` float the image). Settings sets the defaults for
  figures that give no size: natural size, the column width, 75% or 50% of it; no height limit,
  the window or half of it; centred or left; captions numbered, plain or off. Click a figure to
  select it, and drag its corner to resize it (the width is written as `{width=N%}`); double-click, or Ctrl+click, to open it full size in a tab of its own, with zoom and the folder walk.
- **Settings** (the sliders button, or `Ctrl+,`) gathers the preferences in one place: the Markdown font, size and column width, how figures are sized, placed and captioned, editing the Markdown file in place, the interface font (System, machine-made Sans or machine-made Weft), the code font for code blocks, inline code and the raw view (System mono or a Monaspace face), how often to check for changes, and About, with the version and the update check.
- **Edit Markdown in place.** In a rendered Markdown file, select text and press `Ctrl+B` (bold) or `Ctrl+I` (italic), or right-click for Underline, Strikethrough, Code and Edit text… (`Ctrl+E`), which opens the source of the selection, or of its paragraph when the selection crosses a link or formatting, in a small editor. pdf-next writes the `.md` file itself, only if it is still the version on screen, and every edit shows Undo; `Ctrl+Z` undoes it too. Applying a format to text that already has it removes it. On by default; Settings turns it off. A PDF's source is LaTeX, so for a PDF the same wishes are review requests (Make bold, Make italic).
- **Keyboard first:** `j`/`k` scroll, `n`/`p` pages, `g`/`G` first and last, `+`/`-` zoom,
  `←`/`→` tabs (or folder, with one file open), `Delete` deletes a selection in rendered Markdown (undo with `Ctrl+Z`), otherwise moves the shown file to the trash after confirmation, `Ctrl+W` close, `Ctrl+F` find, `Ctrl+R` reload,
  `Ctrl+O` open, `Ctrl+P` print, `Ctrl+U` raw markdown (in rendered Markdown with a selection, underline it), `Ctrl+Shift+A` ask, Enter (with a selection, Review panel open) add a review, `Ctrl+Shift+N` add a review, `Esc` close the review box without saving, `Ctrl+B`/`Ctrl+I`/`Ctrl+E` bold, italic or edit a Markdown selection, `Ctrl+Z` undo a removed review or an edit, `Ctrl+Shift+R` Review panel,
  `Ctrl+Shift+F` fit window to content,
  `Ctrl+Shift+←`/`→`/`↑`/`↓` dock to a screen half, `Ctrl+Shift+Enter` undock.
## Install

| System | Command |
| ------ | ------- |
| Windows | `winget install RicardoFrantz.pdf-next`, or [download the `.exe` installer](https://github.com/machine-made/pdf-next/releases/latest) |
| macOS | `brew install --cask machine-made/tap/pdf-next` |
| Debian, Ubuntu | add the repository below, then `sudo apt install pdf-next` |

### macOS, with Homebrew

The cask lives in a personal tap rather than Homebrew's own repository, so the
tap is named once. Writing it in full does that for you:

```bash
brew install --cask machine-made/tap/pdf-next
```

Or add the tap first and use the short name from then on:

```bash
brew tap machine-made/tap
brew install --cask pdf-next
```

Afterwards:

```bash
brew upgrade --cask pdf-next     # to the newest release
brew uninstall --cask pdf-next   # and `brew untap machine-made/tap` to forget the tap
```

A workflow in the tap reads this repository's releases once a day, so a new
version arrives there within a day of its tag rather than the moment it lands.

### Windows, with winget

pdf-next is in the winget catalog as `RicardoFrantz.pdf-next`. Each release
reaches winget after Microsoft merges its manifest pull request, so winget can
lag a few days behind the `.exe` on
[Releases](https://github.com/machine-made/pdf-next/releases/latest).

```bash
winget install RicardoFrantz.pdf-next
winget upgrade RicardoFrantz.pdf-next
winget uninstall RicardoFrantz.pdf-next
```

### Debian and Ubuntu, with apt

One line:

```bash
curl -fsSL https://raw.githubusercontent.com/machine-made/pdf-next/main/tools/install-apt.sh | sudo sh
```

Or add the signed repository yourself:

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://machine-made.github.io/pdf-next/pdf-next.asc \
  | sudo tee /etc/apt/keyrings/pdf-next.asc > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/pdf-next.asc] https://machine-made.github.io/pdf-next stable main" \
  | sudo tee /etc/apt/sources.list.d/pdf-next.list > /dev/null
sudo apt update && sudo apt install pdf-next
```

Then `sudo apt upgrade pdf-next` for a new version and `sudo apt remove
pdf-next` to take it off. Every version from 0.14.3 on stays in the
repository, so `sudo apt install pdf-next=0.14.3` still installs that one
after a newer release.

Added the repository from the old address, `ricardofrantz.github.io`? That
address now returns 404, so `apt update` reports an error and `apt upgrade`
finds no new version. Replace the source file once, or run the one-line
installer above again, which rewrites it. This command edits the address in
place:

```bash
sudo sed -i 's#ricardofrantz\.github\.io#machine-made.github.io#' /etc/apt/sources.list.d/pdf-next.list && sudo apt update
```

### The file itself

Or take it from [Releases](https://github.com/machine-made/pdf-next/releases):
`.exe` or `.msi` for Windows, a universal `.dmg` for macOS (Intel and Apple
Silicon in one file), `.deb`, `.rpm` or `.AppImage` (`chmod +x` and run) for
Linux.

The Windows `.exe` is one click after SmartScreen: it copies into
`%LOCALAPPDATA%\pdf-next` (no administrator prompt), shows the progress, and
opens. There is no Next / I Agree / Finish. `/W` on the command line brings
the old wizard back if you need it; `/S` stays silent for the Store.

The builds are not code signed yet, so Windows SmartScreen warns once — *More
info → Run anyway* — and macOS quarantines the app and refuses its first
launch, whether it came from Homebrew or the `.dmg`. Let that copy through
once:

```bash
xattr -dr com.apple.quarantine /Applications/pdf-next.app
```

Signing, and how each of these channels is published, are described in
[docs/distribution.md](./docs/distribution.md); what the app does with the
network, in [PRIVACY.md](./PRIVACY.md).

Then open a file by double-clicking it, dragging it onto the window, pressing `Ctrl+O`, or
passing a path:

```bash
pdf-next paper.pdf
```

### Command line

```bash
pdf-next paper.pdf --night --left        # dark pages, filling the left half
pdf-next figure.png --invert             # inverted, for a white-background plot
pdf-next thesis.pdf --sepia --poll 3     # warm paper, check for rebuilds every 3s
pdf-next NOTES.md --sepia                # markdown as warm paper, reloading as you write
pdf-next paper.pdf supp.pdf fig1.png     # three tabs, the first one showing
pdf-next paper.pdf --page 12             # open at page 12
pdf-next paper.pdf --find "Figure 3"     # open at the first match, highlighted
pdf-next 'paper.pdf#page=7&search=wake'  # the same, written as a link
```

| Flag | Effect |
| ---- | ------ |
| `--left` | Dock to the left half of the screen (implies fit-width). |
| `--right` | Dock to the right half (implies fit-width). |
| `--top` / `--bottom` | Dock to the top or bottom half (implies fit-width). |
| `--night` / `--dark` | Dark pages, light text. |
| `--sepia` / `--reader` | Warm paper. |
| `--invert` | Invert the page, for scans and white-background figures. |
| `--plain` / `--light` | Original page colors. |
| `--mode <name>` | Same as the above, by name. |
| `--page <n>` | Open at that page. |
| `--find <text>` | Open at the first match, highlighted. |
| `--dest <name>` | Open at a named destination. |
| `--no-focus` | Hand the file over without raising the window. |
| `--poll <seconds>` | Watch interval; `0` turns watching off. |
| `--wait` | Stay attached to the terminal until the window closes (macOS and Linux — see below). |
| `--help`, `--version` | Print and exit. |

Appearance flags style that window only — they do not change your saved default.

Run it again with another file while it is open and the file joins the running window as
a new tab — the second command returns at once instead of opening a second viewer.

### From scripts and agents

pdf-next behaves like a command-line tool, so a script — or a coding agent — can call it
without guessing:

```bash
pdf-next report.pdf            # prints "opened /abs/path/report.pdf" and returns at once
pdf-next --help                # usage, exit 0
pdf-next missing.pdf           # "pdf-next: no such file: missing.pdf", exit 1
pdf-next --bogus               # "unknown flag --bogus (try --help)", exit 2
```

**Pointing at a place in a document.** `--page 12`, `--find "Figure 3"` and `--dest intro`
say where to land; the same thing can be written on the path as a fragment, in the form PDF
links have always used — `paper.pdf#page=7`, `#nameddest=results`, `#search=Figure%203`,
joined with `&`. Quote it: a shell reads `#` as the start of a comment. The `opened` line
prints the fragment that was understood, so a caller can check rather than assume:

```bash
pdf-next 'paper.pdf#page=7&search=wake' --no-focus
# opened /abs/path/paper.pdf#page=7&search=wake
```

A page past the end lands on the last page and says so. A `--find` with no match leaves the
document where it was, with the find bar showing the query and no results. The three flags
speak about the file named before them, or about the first file when they come first, so
several documents can be aimed at in one command.

If the file is already open in a tab, it is aimed rather than opened a second time — a
running window jumps to the page you asked for. `--no-focus` hands the file over without
raising the window, which is what you want when a script opens six figures in a row.

Exit status is `0` when the file was launched or handed to the running window, `1` for a
file that does not exist or is not a kind pdf-next can show, `2` for a command line it
could not understand. Relative paths
resolve against the caller's directory, including when they are forwarded to a running
instance. On macOS and Linux the launched process detaches by default (own process group,
so a shell tool's timeout cannot take the window down); pass `--wait` to hold the terminal,
as a compile loop might want. On Windows a GUI executable never holds the console.

macOS: a `.app` is not on your `PATH`. Either use the standard idiom — `open -a pdf-next
report.pdf` — which delivers the file to the app (or the running window) the way Finder does,
or make a one-line shim once:

```bash
printf '#!/bin/sh\nexec /Applications/pdf-next.app/Contents/MacOS/pdf-next "$@"\n' \
  > /usr/local/bin/pdf-next && chmod +x /usr/local/bin/pdf-next
```

Then `which pdf-next`, `pdf-next --help` and `pdf-next report.pdf` all work as above. If your
agent has a project instructions file, one line — *"open PDFs with `pdf-next <file>`; use
`open -a pdf-next` on macOS if the shim is missing"* — saves it rediscovering this each time.

#### Review tasks for agents

The review sidecar is a task list for editing the source. An agent needs three things from it,
and each has a short form:

- **Read the open items** from `{stem}_review.agent.txt`, which pdf-next rewrites after every
  change to the store, or print the same text with `pdf-next reviews brief notes.md`. One header
  line, then one line per open item, in reading order:

  ```text
  # notes.md review, revision 12: 3 open, 0 applied, 0 resolved. Close an item: pdf-next reviews done notes.md <id> "<what you changed>", or append "<id> <what you changed>" to notes_review.done
  r3 L7 improve: move this before the table | "the table below"
  r1 L12 improve: say this is an ideal value | "the exit speed v ∗ of the gas"
  r2 L40-42 delete: (no comment) | "the slab burns from both faces at once, so the burning area stays flat until the two fronts meet near the middle of the…"
  ```

  `L12` and `L40-42` are source lines of the `.md` (`p7` is a PDF page), kept current: while
  pdf-next shows the file it finds each review again after edits and records where it now is.
  The quote is shortened and only helps find the place; read the exact text from the file.
- **Close an item** with `pdf-next reviews done notes.md r1 "stated the ideal-gas assumption"`,
  which marks it `applied` with that text as its resolution. For a PDF, add the build command
  that succeeded: `--built "latexmk -pdf paper.tex"`. An agent that can only write files appends
  the same line, `r1 stated the ideal-gas assumption`, to `{stem}_review.done`; pdf-next applies
  it while it has the file open, and every `reviews` command applies it first. The inbox is only
  read, never rewritten; applying it twice changes nothing, the last line for an ID wins, and an
  item you reopen stays open until a new line for it arrives.
- **Read one whole item** from the store itself. `{stem}_review.json` holds one item per line,
  so `grep '"id":"r12"' notes_review.json` prints all of it, and every item has every key
  (`comment` and `resolution` are `""` when empty).

Agents never write the JSON store directly: a full rewrite races with the reader adding items in
the app. `done`, the inbox and `update` take the store's lock.

The `applied` items wait for the reader, who checks the result (the recompiled PDF, or the
Markdown) and marks them `resolved`, or reopens them.

For a PDF, find the quote in the LaTeX entry point or its included chapter files. Use its quote,
surrounding context and PDF position together; an optional SyncTeX source hint is a candidate
to check against the actual source. Edit the `.tex`, compile, and close the item only after the
build succeeds. Leave failed builds open.

For other fields, `pdf-next reviews update` patches one item.
For example, save this object in `patch.json` after checking the current revision:

```json
{
  "status": "applied",
  "resolution": "Reworded the paragraph and compiled paper.tex successfully.",
  "source": { "file": "chapters/method.tex" },
  "build": { "success": true, "command": "latexmk -pdf paper.tex" }
}
```

Then update only that record:

```bash
pdf-next reviews list paper.pdf
pdf-next reviews update paper.pdf --id r12 --patch patch.json --expected-revision 8
```

A record removed by mistake goes back with `restore`, under its own ID, from the record exactly
as `list` printed it: `pdf-next reviews restore paper.pdf --record r12.json --expected-revision 9`.

Use the `revision` printed by `list` for `--expected-revision`. A concurrent update causes a
conflict; reread the store and prepare the patch again instead of overwriting it. `--dry-run`
checks a patch and prints the proposed JSON without saving it. The source field uses the
key `file` for the path actually edited. A SyncTeX hint in that field carries
`method: "synctex"` and `verified: false`; replace it with the source you verified.
Updates preserve unrelated fields and records. Each supplied field replaces its
previous value; include the complete object when replacing `anchor`, `source`, or
`build` so its other keys survive. The sidecar format and a complete record example are in
[`docs/_review.json`](docs/_review.json).

Use the CLI mutation command instead of editing the JSON directly. A raw writer must preserve
IDs and unknown fields, write atomically, and check the sidecar revision; writers that skip
that protocol can overwrite concurrent changes.

The `action` field says what the reader wants: `improve` (the instruction is in `comment`),
`polish` (better wording, same meaning), `clarify` (explain the passage better, same facts; `comment` is an optional note), `shorten`, `expand`, `check` (verify the fact, number or
equation and fix it only if wrong), `define` (add a parenthetical definition `()` after the term;
`comment` is an optional suggestion for the agent to revise and expand), `gloss` (add a brief
inline gloss; `comment` is an optional suggestion), `bold`, `italic` (format the passage in the
source) and `delete` (remove the passage). For the actions other than `improve`, `comment` is an
optional note or suggestion.

The review card also has buttons, clicked instead of typed. They are saved in `requests` as
`group:name` words, and the agent view spells each out as an instruction:

| Row | Words | The agent reads |
| --- | --- | --- |
| Ask | `ask:why`, `ask:how`, `ask:more`, `ask:example`, `ask:source`, `ask:derive` | explain why, explain how, give more information, give an example, give the source, show the derivation |
| Change | `change:simplify`, `change:shorten`, `change:expand`, `change:check`, `change:figure` | simplify, shorten, expand, check facts, numbers and equations, add or improve a figure |
| Scope (one) | `scope:phrase`, `scope:paragraph`, `scope:section` | how much of the text the request covers |
| Tone (one) | `tone:formal`, `tone:plain`, `tone:jfm` | more formal, plainer, Journal of Fluid Mechanics style |

Buttons with no note save as action `request`; with another action they refine it. An Ask is a
question to the agent: the answer goes in the done note (`pdf-next reviews done … "<answer>"`),
and the text changes only when the item also asks for a change. In the agent view:

```text
r4 L12 request: explain why; explain how; scope: the whole paragraph | "the residual check passes"
```

The PDF quote is a rendered-text target, not a `.tex` line number. LaTeX commands, macros,
hyphenation, equations and included files can change how text appears. Check the surrounding
source before editing; an equation symbol needs its equation context and position, so do not
copy a symbol in isolation. Record the source file that actually changed. A disappeared quote
does not prove that a Delete request succeeded, and completing a task never removes its record.
Do not delete records from the sidecar to mark them done: set `applied`. While pdf-next shows the
file, it keeps the open reviews pinned to their text as you edit, and `list` then prints their
current lines.

## Security

The threat model is the obvious one: you open a PDF someone sent you, and the attacker controls
every byte of it.

- **The window cannot navigate away from the app.** A link annotation in a malicious PDF used to
  be able to replace the entire viewer with an attacker-controlled page — in a window with no
  address bar — and a link pointing back at the asset protocol would be served as HTML at a
  *local* origin, which Tauri trusts with IPC. A navigation guard now rejects anything that is
  not the app's own origin. A web link in a PDF (`http`, `https`) opens in your system
  browser, never in the window; `mailto` and other schemes do nothing; internal ones, like a table of contents, scroll.
- **The webview can read the files you opened, and the local images they show.** Document
  bytes are served by a purpose-built `doc://` protocol whose handler checks every request
  against the set of files you opened this session and the local image files that an opened
  Markdown file shows — an allowlist in our own Rust code, populated only by the open path and
  the Markdown renderer. Review commands also access the adjacent review sidecar and query an optional
  local SyncTeX mapping; source hints must point to `.tex` files inside the PDF folder.
- **The one file the app writes is a Markdown file you opened, and only when you edit it.** Direct
  edits go through one Rust command that accepts only a `.md` from the set you opened, refuses
  the write unless the file's digest is still the one on screen and the text at the edit is still
  the text you selected, and replaces the file atomically with its permissions kept. A PDF is
  never written.
- **Markdown is sanitized before it exists as HTML.** A `.md` is parsed and scrubbed by
  ammonia on the Rust side; scripts, event handlers and `javascript:` URLs never cross into
  the window, only local image files are loaded (never web or network paths), and the CSP forbids
  inline script besides.
- **One network host, on request only.** The CSP names `api.github.com` and nothing else, so
  the update check can ask for the latest release when you press the button — and an injected
  script has nowhere else to talk to. The download itself is opened in your browser through a
  Rust command that accepts only URLs under this project's Releases; the webview cannot ask
  the OS to open anything else.
- **Two permissions total** — listen and unlisten for events. Everything else, including path
  resolution and the file dialog, is driven from Rust where the frontend cannot reach it.
- No `eval`, no WASM execution, no plugins, no framing, and PDF scripting is off, so a document
  cannot execute anything on its own.
- Generic PDF stream decoding is capped at 64 MiB per stream and 256 MiB of cumulative
  allocations per document, including intermediate filter layers and decompression copies.
  Software decoders enforce these limits before allocating output; the native decompression
  fast path is disabled because it cannot enforce a byte quota. Image filters must be the final
  decoding layer. A document that exceeds either limit fails decoding; opening it again starts
  a fresh budget.

## Memory, measured not claimed

Numbers from Windows 11, WebView2 151, whole process tree, the 15-page *Attention Is All You
Need* paper:

| | Working set | Private bytes |
| --- | --- | --- |
| Window open, no document | 376 MB | 189 MB |
| 15-page PDF open | 431 MB | 257 MB |

**Be clear about what this means.** The document costs about 55–70 MB; everything else is the
WebView2 (Chromium) floor, which is the same floor every Chromium-based app pays and is partly
shared memory counted against every process using it. The binary is ~5 MB and starts instantly,
but "low memory" here means *lower than Electron*, not *lower than a native viewer* — Electron
would ship its own copy of Chromium on top of this. A native renderer such as pdfium would be
dramatically lighter and is the honest alternative if resident memory is the only thing you
care about.

Linux (WebKitGTK) and macOS (WKWebView) use different engines with different, usually smaller,
floors — those are not measured yet.

**Reloading used to leak badly.** Each reload dropped the previous PDF.js document without
destroying it, which kept its worker thread, font and image caches and rendered canvases alive:
**77 MB per reload, unbounded**, so an afternoon of LaTeX would reach several gigabytes. Now the
document is torn down, one worker is shared for the life of the process instead of one spawned
per reload, page views free their canvases instead of waiting for the collector, and reloads are
skipped entirely while the window is hidden.

What remains scales with the document, not with the number of reloads. The ~10 MB-per-reload
growth that used to point at the webview caching each cache-busted URL is gone: documents are
served from a purpose-built `doc://` protocol with `Cache-Control: no-store`, so no revision
ever enters the HTTP cache, and the asset protocol has been dropped entirely. On top of that,
hiding the window now also releases the PDF.js font and image caches (they rebuild lazily when
you come back), and a background tab holds neither a decoded image nor a rendered markdown DOM.

## Building

Needs [Rust](https://rustup.rs) and, on Windows, the MSVC build tools:

```bash
bun install
bun run dev      # dev window with reload
bun run build    # installers into src-tauri/target/release/bundle
```

On Ubuntu, install the webview dependencies first:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml   # the Rust side
node tools/check_frontend.mjs                     # the frontend contracts
bun run build && node tools/smoke.mjs             # open every fixture, for real
```

`check_frontend.mjs` enforces the invariants that are easy to break silently: a real PDF.js
worker, streaming instead of whole-file reads, the canvas budget, the one-second poll, and the
mid-build gap behaviour.

`tools/smoke.mjs` launches the binary that was just built, once per file in `tests/fixtures`,
with `PDF_NEXT_SMOKE=1` in the environment. In that mode the app answers for itself: it waits
for a page to be drawn with pixels in it, then reports through a Tauri command and exits on
that answer, so a window that opens and stays empty fails the run instead of passing it.
`PDF_NEXT_SMOKE_TIMEOUT` bounds a launch that never reports; `PDF_NEXT_BIN` names a binary
somewhere else.

The fixtures are built by `python3 tests/make_fixtures.py`, which writes the same bytes on
every machine, so a change to them is a change someone made.

All three run on Windows, macOS and Linux for every push, and a release stays a draft until
each platform's bundle has opened a document.

## What it is built with

Every part pdf-next is made of, what it does here, and its licence. Versions are the ones this
release ships; the frontend libraries are vendored under `src/vendor/`, each with a `VERSION`
file that records its source and checksum.

**The app shell (Rust)**

| Part | Version | What it does in pdf-next | Licence |
| --- | --- | --- | --- |
| [Rust](https://www.rust-lang.org) | 1.96 or newer | The native side: files, watching, reviews, Markdown, PDF reduction, printing. | MIT / Apache-2.0 |
| [Tauri](https://tauri.app) | 2.11.5 | The window, the bridge between Rust and the page, bundles and installers. | MIT / Apache-2.0 |
| [wry](https://github.com/tauri-apps/wry) and [tao](https://github.com/tauri-apps/tao) | 0.55 / 0.35 | Tauri's webview and window layers: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux. | MIT / Apache-2.0 |
| tauri-plugin-dialog | 2.7.2 | The system Open dialog. | MIT / Apache-2.0 |
| tauri-plugin-single-instance | 2.4.3 | A second `pdf-next file.pdf` opens a tab in the running window. | MIT / Apache-2.0 |
| [serde](https://serde.rs), serde_json | 1.0 | Reads and writes the review sidecar and every message to the page. | MIT / Apache-2.0 |
| [sha2](https://github.com/RustCrypto/hashes) | 0.10.9 | The `sha256:` digests that tell one version of a file from another. | MIT / Apache-2.0 |
| [tempfile](https://github.com/Stebalien/tempfile) | 3.27 | Atomic writes: the sidecar, a reduced PDF, a Markdown edit. | MIT / Apache-2.0 |
| [cap-std](https://github.com/bytecodealliance/cap-std) | 3.4.6 | Keeps review writes inside the folder of the document that was opened. | Apache-2.0 / MIT |
| [open](https://github.com/Byron/open-rs) | 5.4.1 | Hands a checked web link to the default browser. | MIT |
| percent-encoding | 2.3.2 | Encodes local paths for the document protocol. | MIT / Apache-2.0 |
| gio (Linux), objc2 (macOS), windows-sys (Windows) | 0.18 / 0.6 / 0.61 | Move to trash, the macOS drag pasteboard, the Windows console and print checks. | MIT (/ Apache-2.0) |

**Markdown and TeX**

| Part | Version | What it does in pdf-next | Licence |
| --- | --- | --- | --- |
| [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark) | 0.13.4 | Parses Markdown: CommonMark plus tables, task lists, footnotes, strikethrough, smart punctuation and `$…$` math. | MIT |
| [ammonia](https://github.com/rust-ammonia/ammonia) | 4.1.4 | Sanitizes the HTML before it reaches the page: no scripts, no event handlers. | MIT / Apache-2.0 |
| [math-core](https://github.com/tmke8/math-core) | 0.9.0 (pinned) | Turns TeX equations into MathML Core, drawn by the webview itself. | MIT |
| New Computer Modern Math | in `vendor/math-core` | The equation font. | GUST Font License |
| Latin Modern Roman | in `vendor/latin-modern` | The default Markdown text font, the TeX look. | GUST Font License |
| [highlight.js](https://highlightjs.org) | 11.12.0 | Colours code blocks: Bash, C, C++, CMake, diff, Fortran, INI, JavaScript, JSON, Julia, LaTeX, Makefile, MATLAB, Python, Rust, shell, YAML. | BSD 3-Clause |
| [machine-made type](https://github.com/machine-made/type) | 0.1.0 | Weft, Sans and Heddle: optional Markdown and interface fonts. | SIL OFL 1.1 |
| [Monaspace](https://github.com/githubnext/monaspace) | 1.400 | Neon, Argon, Xenon, Radon and Krypton: optional Markdown and code fonts. | SIL OFL 1.1 |
| [dockview](https://github.com/dockview/dockview) | 8.8.0 | The pane layout: tiles with tabs, split and moved by dragging. | MIT |
| [diff-match-patch](https://github.com/google/diff-match-patch) | 1.0.5 | The word-by-word before/after of an applied review. | Apache-2.0 |

**PDF**

| Part | Version | What it does in pdf-next | Licence |
| --- | --- | --- | --- |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 6.3.289 | Parses and renders PDFs in a worker, with find and the text layer for reviews. Patched (see `vendor/PDFJS_VERSION`): smaller page cache, sharper zoomed crops, bounded stream decoding. | Apache-2.0 |
| [lopdf](https://github.com/J-F-Liu/lopdf) | 0.44 | Reads PDF structure on the Rust side, with limits on stream decompression. | MIT |
| [picamatl](https://github.com/xcheljd/picamatl) | 0.4.4 | Reduce PDF: writes a smaller `{name}_reduced.pdf` in pure Rust, no Ghostscript. | MIT / Apache-2.0 |
| SyncTeX | from your TeX install | When a `.synctex.gz` sits next to a PDF and the `synctex` program from your TeX distribution is on the PATH, a review can carry a hint of the `.tex` line. pdf-next ships no SyncTeX of its own; without it the hint is simply left out. | (TeX distribution) |

**Building and checking**

| Part | What it does | Licence |
| --- | --- | --- |
| [Tauri CLI](https://tauri.app) 2.11.4, run with [Bun](https://bun.sh) | Builds the app and its installers. | MIT / Apache-2.0 |
| NSIS (Windows), DMG (macOS), deb, rpm and AppImage (Linux) | The installers Tauri makes. | zlib / various |
| Node.js | Runs `tools/check_frontend.mjs` and the smoke test. | MIT |

The page itself is plain JavaScript modules, HTML and CSS: no framework and no build step.

## Scope

A viewer first. No annotations, no forms, no cloud. It opens a file, keeps it current, and gets
out of the way. The one exception is small, deliberate edits to a Markdown file you are reading
(bold, italic, a reworded sentence), each one checked against the file on disk and undoable.

pdf-next is made by machine-made, a lab for software built with AI agents. MIT licensed. Built on [Mozilla PDF.js](https://github.com/mozilla/pdf.js) and
[Tauri](https://tauri.app).

## Code signing policy

Windows builds are to be signed through the SignPath Foundation: free code signing provided by
[SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).
Roles, the build that is signed and the privacy statement are in
[docs/code-signing.md](docs/code-signing.md). Until the signing is in place, releases are unsigned
and every Windows installer is scanned with Microsoft Defender before it is published.

## Disclaimer

This software is provided "as is", without warranty of any kind. To the extent
permitted by law, the authors and contributors are not liable for any damage, loss
or claim arising from its use or misuse. You are responsible for how you use it and
for following the laws and rules that apply to you. The full terms are in
[LICENSE](LICENSE).

pdf-next is not affiliated with or endorsed by Mozilla. PDF.js is © Mozilla and
contributors, under the Apache License 2.0.

The machine-made Weft, Sans and Heddle fonts come from [machine-made/type](https://github.com/machine-made/type) under the SIL Open Font License 1.1; their licences are in `src/vendor/machine-made-type/`.

The Monaspace fonts are © 2023 GitHub, from [githubnext/monaspace](https://github.com/githubnext/monaspace) under the SIL Open Font License 1.1; the licence is in `src/vendor/monaspace/OFL.txt`.

Markdown code colours come from highlight.js 11.12.0 (BSD 3-Clause, © Ivan Sagalaev and contributors); its licence is in `src/vendor/highlightjs/LICENSE`.

The review before/after uses Google's diff-match-patch 1.0.5 (Apache-2.0, © the diff-match-patch authors); its licence is in `src/vendor/diff-match-patch/LICENSE`.
