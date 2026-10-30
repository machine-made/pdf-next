# pdf-next

*pdf-next by machine-made.*

You write in one window and read in another. pdf-next is the other window.

Point it at the PDF your LaTeX or Typst build writes, or at the Markdown file you are
editing, and it redraws every time the file changes, on the same page, at the same zoom,
in the same spot. You stop switching windows to press reload. Then it gets out of the way:
no ribbon, no account, nothing to sign in to, and nothing downloaded after you install it.

[![CI](https://github.com/machine-made/pdf-next/actions/workflows/ci.yml/badge.svg)](https://github.com/machine-made/pdf-next/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Website](https://img.shields.io/badge/site-machine--made.github.io%2Fpdf--next-blue)](https://machine-made.github.io/pdf-next/)

It opens PDFs, Markdown and images (`.png`, `.jpg`, `.webp`, `.avif`) on Windows, macOS and
Linux. It is the desktop sibling of [vscode-pdf Next](https://github.com/machine-made/vscode-pdf-next)
and draws pages the same way, with Mozilla PDF.js (`pdfjs-dist@6.3.289`) in a worker thread.

## A quick tour

### It follows your file

- **Rebuild and look.** Watching is on by default. Save or rebuild and the view updates
  within a second, keeping your page, scroll position and zoom. The View menu sets how often it
  looks (1 s, 2 s, 3 s, or off). If the build deletes the file first, the last page stays on
  screen with a red dot until the new file lands.
- **See what the rebuild changed.** In Markdown the changed blocks light up for a few seconds;
  in a PDF the new words do, and thin ticks along the right edge show where on the whole
  document the changes are. The ticks stay, faint, until the next build; click one to go
  there, or press `.` and `,` for the next and previous change. Pages that did not change get
  nothing, and a page the build added is marked whole. A long thesis is compared page by page
  in the background, so the reload is as quick as before.
- **It never shows a half-written file.** A build takes hundreds of milliseconds to write a
  PDF, and a naive viewer reloads the half it has. pdf-next waits until the file is whole: on
  Windows the writer holds a lock, so opening it fails until it is done; on macOS and Linux it
  also checks for the PDF's closing `%%EOF`. If the file is not ready, it tries again next tick.
- **Your build can always write.** The page is kept in memory and the file is closed after
  reading, so you can overwrite, replace or delete it while it is on screen.
- **Sharp on any screen.** Pages redraw when you move the window to a display with a
  different scale, and deep zoom only draws what you can see.

### The window fits the page

- **It opens at the size of what you opened.** A paper comes up at 100% in a window the size
  of its page, centred; a wide figure gets a wide window. A figure bigger than the screen, such
  as a plot saved at 400 dpi, is scaled down until it fits whole. A page taller than the
  monitor fills the screen's height and scrolls. This only happens when you open a file:
  rebuilds and tab switches never move your window.
- **Dock it to half the screen** with the Window menu (a small picker laid out like the
  screen) or `Ctrl+Shift+←` / `→` / `↑` / `↓`, so the document takes one half and your editor
  the other. Docked, it fits the width, so the text stays readable. The centre of the picker,
  `Ctrl+Shift+Enter`, or the same edge again undocks.
- **Or bring the window to the content** with `Ctrl+Shift+F`: set a figure to the size you
  want and the window closes in on it, edge to edge. It stays on, so zooming moves the window
  with you, up to the size of your screen. Picking a fit from the zoom menu turns it off.
- **Full screen** with `F11`, or from the Window menu. `F11` again comes back.
- **Present** with `F5`: full screen, no toolbar, one page at a time fitted to the screen, on
  black. `←` / `→`, `PageUp` / `PageDown` (what a presentation clicker sends), `Space`, `Home`
  and `End` move through the pages; `Esc` comes back to the view, zoom and page you had. A
  Markdown file is shown as its A4 pages.

### Tabs and panes

- **Tabs that cost nothing.** Open several files and they line up in a strip. Move with
  `←` / `→`, `Ctrl+Tab`, `Ctrl+1`…`9` or the mouse wheel over the strip; `Ctrl+W` closes one.
  Only the files on screen are in memory, so six papers cost what one does, and a tab you come
  back to is read fresh from disk.
- **It remembers your place.** Close a file and open it again, later the same day or after a
  restart, and it comes back on the page, at the spot and the zoom where you left it. Markdown
  comes back to the paragraph you were reading, a picture to its zoom. `--page`, `--line` and
  `--find` still say where to land. The last 300 files are remembered, on this computer only.
- **Start where you left off.** With nothing open the window is a small drop target with the
  last eight files you opened under it, each with its folder and when you opened it. Click one or
  press Enter; the arrows move through the list, and `Delete` takes a file off it (never off the
  disk). A file that is no longer there is dimmed, and leaves the list when you pick it. Open
  recent… in the command palette lists the same files.
- **Panes, like a terminal.** `Ctrl+Shift+D` splits the window to the right, `Ctrl+Shift+E`
  splits it down, and the Panes menu in the View menu does the same. Each pane has its own tabs:
  drag a tab to another pane, to a pane's edge to split it again, or onto a tab strip to merge;
  drag the line between panes to resize, or move the live pane's edge from the keyboard with
  `Ctrl+Alt+Shift+←/→/↑/↓`; `Ctrl+Alt+←/→/↑/↓` moves between them. `Ctrl+Shift+M`, or a
  double click on the empty part of a tab strip, gives the whole window to one pane and brings
  the others back. Any file works
  in any pane. The pane you click is the live one, with editing, find, zoom and the Review
  panel. The others stay where you left them and keep following their files: the PDF next to
  your notes reloads by itself when it is rebuilt, and images and Markdown do too. Every pane
  shows its document's review marks, and while find is open, its matches. Press and drag in another pane to make it live and select
  there in one go. The layout is saved with the session; close down to one pane and the plain
  tab strip comes back.

### Find your way

- **An outline when you want one.** `Ctrl+Shift+O` opens a sidebar on the left with the PDF's
  own outline, or the headings of a Markdown file, and pushes the page over rather than covering
  it. The section you are reading is marked as you scroll; click one, or move with the arrow keys
  and press Enter, to go there, and Esc hands the keyboard back to the page. Drag its edge to
  make it wider; the width is remembered. It stays open and scrolled through rebuilds, and with
  panes it shows the live one.
- **Pages at a glance.** The Pages tab shows small pictures of a PDF's pages, drawn only as they
  come into view and let go when the sidebar closes.
- **Back where you were.** Following a link, an outline entry, a find result, `g`/`G` or a page
  number remembers the place you left, page, scroll and zoom. `Alt+←` and `Alt+→`, or the back
  and forward buttons on the mouse, step through those places; ordinary scrolling does not count.
  Each tab has its own trail.
- **See where a link goes before you go.** Rest the pointer on a link to an equation, figure,
  section or reference for a moment and a small card shows what it points at: the spot on the
  target page in a PDF, the heading, footnote or equation itself in Markdown. Click to follow it
  as before; move away or press Esc and it is gone.

### Figures

- **Walk a folder of figures.** With one file open, `←` / `→` (or the toolbar arrows) step
  through every image beside it in reading order, `fig2` before `fig10`. Each one fills the
  window, which stays put. The rotate button turns a picture a quarter turn; the next one comes
  up upright.
- **Throw one away.** `Delete` (`⌘⌫` on macOS) asks first, then moves the file to the Recycle
  Bin or Trash, where you can get it back. Where there is no trash, such as a network share or
  `\\wsl.localhost`, it asks whether to delete for good. In a folder of figures the next one
  opens.
- Images zoom with the same control, keys, wheel and pinch as a PDF.

### Markdown that reads like a paper

- **Typeset, not previewed.** A `.md` opens as a reading column in Latin Modern Roman at 17 px
  on a 38 em measure, hyphenated, with tables, task lists, footnotes and strikethrough. It is
  parsed by [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark) in Rust and
  cleaned by [ammonia](https://github.com/rust-ammonia/ammonia) before it reaches the window,
  so a hostile file cannot run anything. `Ctrl+U` with nothing selected (or Raw Markdown in the
  View menu) shows the raw text and back. Zoom reflows the text instead of scaling it.
- **Equations.** `$…$`, `$$…$$` and a fenced `math` block are TeX, turned into MathML by
  [math-core](https://github.com/tmke8/math-core) in the same Rust pass and set in New Computer
  Modern Math, with no JavaScript maths engine and nothing fetched. Numbered environments,
  `\label` and `\eqref`, `\newcommand` across a file, and `split` work. An equation that fails
  to convert, loops, or is too large shows as its TeX source; an unknown command is marked in
  red and the rest still renders. An `\eqref` to an equation further down shows `(??)`.
- **Your choice of type.** The View menu sets the font (Latin Modern; the machine-made faces
  Weft, Sans and Heddle; Serif, Sans, Mono; and GitHub's five Monaspace faces Neon, Argon,
  Xenon, Radon and Krypton), the size (14 to 48 px) and the column width (in pixels, or 100%;
  720 px by default). Each choice is remembered. The mouse wheel over any of these menus (zoom,
  page view, font, size, width, panes, reload interval) steps through it without opening it;
  over the zoom menu or its buttons it zooms.
- **Coloured code.** Fenced blocks tagged python, c, cpp, rust, fortran, julia, bash, shell,
  toml, yaml, json, latex, matlab, makefile, cmake, diff or javascript (and short tags like
  `py`, `rs`, `f90`, `sh`, `tex`, `yml`) are coloured by highlight.js in every colour mode. The
  raw view stays plain, and so does a block over 64 KiB or code past 512 KiB in one file.
- **Pages, if you want them.** The page-view menu shows a PDF as Single page or Two pages (the
  cover alone, then pairs, like a printed book), and Markdown as Continuous, Single page or
  Two pages. Markdown pages are A4 with 25 mm margins and never split a paragraph, table, code
  block or equation; a heading moves to the next page with what follows it. Reviews, find and
  line links work the same in every view, and each page prints on its own sheet.
- **Figures with captions.** An image alone on its line is a figure: its alt text is the
  caption, numbered down the file. Size and place it the way Pandoc and Quarto do:
  `![Wake behind the cylinder](wake.png){width=60%}`, `{width=8cm}` (also `mm`, `in`, `pt`,
  `px`), `{height=300}`, and `.left`, `.right` or `.center`. Settings picks the defaults for
  figures that give no size. Click a figure and drag its corner to resize it (the width is
  written back as `{width=N%}`); double-click it to open it full size in its own tab.
- **Local images and links.** `![](fig.png)` shows an image from your disk by a relative or
  absolute path, up to 64 MiB, and reloads when the image changes. Web, `data:`, `file:` and
  network-share sources are not loaded; a refused image shows its alt text in a marked box. A
  `#heading` or footnote scrolls; a web link opens in your browser; a link to another file
  pdf-next can show opens it as a tab. Nothing ever navigates the viewer itself.
- **See what changed.** When the file is rewritten, the paragraphs, headings, list items,
  tables and equations that changed light up and fade over a few seconds, and your scroll
  position stays.
- **Edit in place.** Select text and press `Ctrl+B` (bold) or `Ctrl+I` (italic), or right-click
  for Underline, Strikethrough, Code and Edit text… (`Ctrl+E`), which opens the source of the
  selection, or of its paragraph when the selection crosses a link or formatting, in a small
  editor. pdf-next writes the `.md` itself, only if it is still the version on screen, and
  every edit can be undone with the Undo button or `Ctrl+Z`. A format that is already there is
  taken off. On by default; Settings turns it off. A PDF's source is LaTeX, so for a PDF the
  same wishes become review requests (Make bold, Make italic).

### Notes for the next draft

- **Mark what needs work.** With the Review panel open (`Ctrl+Shift+R`), select a passage and
  say what it needs. Improve takes an instruction; Polish (wording only, same meaning),
  Shorten, Expand, Check (verify a fact, number or equation), Make bold, Make italic and
  Delete say it for you, with an optional note. The Ask buttons (Why?, How?, More info,
  Example, Source?, Derive) mean "this is unclear, rewrite it so it answers this". With the
  panel closed, a selection is just for copying.
- **The notes live next to the document**, in `{stem}_review.json` (`paper.pdf` →
  `paper_review.json`): the quote, its page or line and the text around it, a stable ID, the
  request, its status and what was done about it. Saving a note never changes the PDF or its
  source; Delete means "remove this passage from the source". Whoever edits the source (you,
  a co-author, or an agent) works through the list and marks each item applied; you check the
  new build and resolve it. A note follows its text as the file changes, even after nearby
  edits; a quote that was itself reworded is marked with a dashed line between its old
  neighbours. Reattach pins a note to other text. Remove review shows Undo for ten seconds,
  and `Ctrl+Z` brings it back with the same ID. Esc, the × or Cancel closes the review box
  without saving. − and + in the panel head change the text size. Not available for images.
- **Check what changed.** A Markdown note remembers its paragraph as it was (`before`). Once
  it is applied, the Review panel shows a word-by-word before and after: removed words struck
  out, new ones highlighted, long unchanged stretches folded to …. Resolve closes it; Reopen
  asks for a short note on what is still wrong and sends it back. When whoever is editing
  needs you to decide something, the item turns into a question, marked with a ? on its
  highlight and in the panel, with a field for your answer.

### Everything else

- **Zoom where you point.** `Ctrl`+wheel (`⌘`+wheel on macOS) or a pinch on the trackpad zooms
  around the point under the cursor. The page follows your fingers at once and is drawn again,
  sharp, the moment you stop; passing Fit width or Fit page, it settles there for a moment. In
  Markdown the wheel steps the text size and the paragraph under the cursor stays put. `+`, `-`
  and the zoom menu zoom around the middle of the view.
- **A quiet toolbar.** The bar keeps to what you reach for while reading: open, the page, zoom,
  find, the View menu, the Window menu, the Review panel and Settings. The View menu holds the
  page view, raw Markdown, the Markdown font, size and width, panes, the page mode, how often
  to check for changes, copying the path or name, print and Reduce PDF; only what applies to
  the open file shows. Arrows move through a menu, `Esc` closes it. Everything is also in the
  command palette.
- **Focus mode.** Once you start reading, the toolbar fades after a couple of seconds, in place,
  so the page does not move. Bring the pointer to the top of the window, press `Alt`, or tab
  into it and it comes back; it stays while the Review panel, Settings, find, the palette or a
  menu is open. Settings ("Hide the toolbar while reading") or the palette turns it off.
- **Dark mode that respects the page.** It follows your system, and Page mode in the View menu
  can recolour PDF pages themselves: Clear → Night → Invert → Sepia. Night and Sepia turn the paper
  and the black text to their own colours but keep a figure's colours: a blue line stays blue,
  only lighter or darker, so plots stay readable. They look the same on Windows, macOS and
  Linux, and printing still gives white paper. Shift+click goes straight back to Clear.
- **Find** with match counts (`Ctrl+F`), powered by PDF.js. The other panes on screen mark the
  matches too.
- **Print** with `Ctrl+P`, through your system's own dialog, with your printers, page range,
  copies, duplex and paper size. A PDF is redrawn at 150 dpi on white, so what comes out is
  the page, not the screen, and A4 prints at true size on A4. Markdown reflows across sheets,
  and an image gets a sheet of its own. With nothing to print to, it says so.
- **Reduce a PDF** from the View menu, under Print. A pure-Rust pass (no Ghostscript) writes a
  smaller `{stem}_reduced.pdf` beside the original when it can, and opens it as a tab.
- **Copy the path or the name** from the View menu.
- **Opens where you ask.** `--page 12`, `--find "Figure 3"` and `--dest results` say where to
  land, or write it on the path the way a PDF link does: `paper.pdf#page=7&search=wake`. For
  Markdown, `--line 42` or `#line=42`; `--find` and `#search=` work there too. A file that is
  already open is aimed at, not opened twice; `--no-focus` hands it over without raising the
  window.
- **The title names the build** (`paper.pdf — pdf-next 0.17.0`), so a bug report can say
  which version without an About box.
- **It tells you when there is a newer version.** A few seconds after launch it asks GitHub
  once for the latest release; if there is one, a button appears at the end of the toolbar,
  and a press opens the installer for your system from the Releases page in your browser.
  That one request is the only network access the app makes on its own; nothing polls, and
  downloads only happen when you press.
- **Settings** (the sliders button, or `Ctrl+,`) has the Markdown font, size and width, how
  figures are sized and captioned, editing in place, the interface font (System, machine-made
  Sans or Weft), the code font (System mono or a Monaspace face), how often to check for
  changes, focus mode, and About.
- **Command palette** with `Ctrl+K` (`⌘K` on macOS): every action, setting and open file in
  one list, each with its shortcut. Type a few letters of each word (`mono neon`, `split r`,
  `go paper`) and press Enter. It only shows what applies to what you have open, and the
  commands you used last come first.
- **Keyboard first:** `Ctrl+K` command palette, `j`/`k` scroll, `n`/`p` pages, `g`/`G` first
  and last, `.`/`,` next and previous change, `+`/`-` or `Ctrl`+wheel zoom, `←`/`→` tabs (or the folder, with one file open),
  `Ctrl+W` close, `Ctrl+F` find, `Ctrl+Shift+O` outline, `Alt+←`/`Alt+→` back and forward,
  `Ctrl+R` reload, `Ctrl+O` open, `Ctrl+P` print, `Ctrl+U` raw Markdown (with a selection in
  rendered Markdown, underline), `Ctrl+B` / `Ctrl+I` / `Ctrl+E` bold, italic or
  edit a selection, `Delete` delete a selection in rendered Markdown (otherwise trash the file,
  after asking), `Ctrl+Z` undo an edit or a removed review, `Ctrl+Shift+R` Review panel,
  `Ctrl+Shift+N` or Enter (with a selection and the panel open) add a review,
  `Ctrl+Shift+A` copy the selection as a review quote, `Esc` close the review box,
  `Ctrl+Shift+F` fit the window to the content, `Ctrl+Shift+←`/`→`/`↑`/`↓` dock to a screen
  half, `Ctrl+Shift+Enter` undock, `F11` full screen, `F5` present, `Alt` show the toolbar.

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

The review sidecar is a task list for editing the source. An agent needs a few things from it,
and each has a short form:

- **Read the open items** from `{stem}_review.agent.txt`, which pdf-next rewrites after every
  change to the store, or print the same text with `pdf-next reviews brief notes.md`. One header
  line, then one line per open item, in reading order:

  ```text
  # notes.md rev 12: 3 open, 0 applied. Fix each in the source. Done: pdf-next reviews done notes.md <id> "<what you changed>" (or the line "<id> <what you changed>" in notes_review.done). Unclear: pdf-next reviews ask notes.md <id> "<question>"
  r3 L7 move this before the table | "the table below"
  r1 L12 say this is an ideal value | "the exit speed v ∗ of the gas"
  r2 L40-42 delete | "the slab burns from both faces at once, so the burning area stays flat until…"
  ```

  `L12` and `L40-42` are source lines of the `.md` (`p7` is a PDF page), kept current: while
  pdf-next shows the file it finds each review again after edits and records where it now is.
  The quote is cut to 80 characters and only helps find the place; read the exact text from the
  file. A line names its file only when the store holds reviews of more than one file.
- **Read only what changed**: `pdf-next reviews brief notes.md --since 12` lists the open items
  changed after revision 12, the one in the header you read last. Every item carries `rev`, the
  store revision of its last change.
- **Take one item at a time** with `pdf-next reviews next notes.md`: the first open item in
  reading order, and for Markdown the source lines it points to, numbered (for a PDF, the page
  and a longer quote). When nothing is open it says so and exits 0.

  ```text
  # notes.md: 3 open. Done: pdf-next reviews done notes.md r3 "<what you changed>" (unclear: pdf-next reviews ask notes.md r3 "<question>")
  r3 L7 move this before the table | "the table below"
  7| See the table below for the cases.
  ```

- **Close an item** with `pdf-next reviews done notes.md r1 "stated the ideal-gas assumption"`,
  which marks it `applied` with that text as its resolution. For a PDF, add the build command
  that succeeded: `--built "latexmk -pdf paper.tex"`. An agent that can only write files appends
  the same line, `r1 stated the ideal-gas assumption`, to `{stem}_review.done`; pdf-next applies
  it while it has the file open, and every `reviews` command applies it first. The inbox is only
  read, never rewritten; applying it twice changes nothing, the last line for an ID wins, and an
  item you reopen stays open until a new line for it arrives.
- **Ask the reader** when an item cannot be done without them:
  `pdf-next reviews ask notes.md r4 "Which reference do you mean?"`, or the inbox line
  `r4 ? Which reference do you mean?`. The item gets status `question` and the text in
  `question`; it leaves the list, and the header counts it as waiting on the reader. When the
  reader answers in the app, the answer is saved in `reply` and the item is `open` again, with
  `you asked "…", reader replied: "…"` in its line. pdf-next before 0.17 does not know
  `question`: it cannot read a store while an item waits on the reader, and its inbox reads
  `r4 ? …` as a done note. Use `ask` only when the app and the CLI are 0.17 or later.
- **Read one whole item** from the store itself. `{stem}_review.json` holds one item per line,
  so `grep '"id":"r12"' notes_review.json` prints all of it, and every item has every key
  (`comment` and `resolution` are `""` when empty).

Agents never write the JSON store directly: a full rewrite races with the reader adding items in
the app. `done`, `ask`, `add`, `relocate`, the inbox and `update` take the store's lock.

The `applied` items wait for the reader, who checks the result (the recompiled PDF, or the
Markdown) and marks them `resolved`, or reopens them.

Scripts and agents can file reviews too:

```bash
pdf-next reviews add notes.md --line 12 --quote "the exit speed" --request ask:why --request scope:paragraph
pdf-next reviews add paper.pdf --page 7 --quote "the residual check passes" --action check --comment "with which tolerance?"
```

`--line N [--end M]` is for Markdown and `--page N [--end M]` for a PDF; `--request` takes the
review card words below (repeatable), `--action` the actions below, and `--comment` a note. The
review is checked like one made in the app and the new ID is printed. A Markdown review gets its
context from the source when the quote is found there.

After editing a Markdown file without pdf-next open, `pdf-next reviews relocate notes.md` finds
the open reviews again, as the app would, and records their new lines and context. A quote whose
own words were edited is looked for near its old line. It prints `moved L3 -> L6`, `unchanged` or
`not found` per item; applied and resolved items are left alone. `--expected-revision N` refuses
to write if the store changed since you read it, and `--dry-run` writes nothing.

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

The `status` is `open`, `applied`, `resolved` or `question` (waiting on the reader). The
`action` field says what the reader wants: `improve` (the instruction is in `comment`),
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
| Ask | `ask:why`, `ask:how`, `ask:more`, `ask:example`, `ask:source`, `ask:derive` | make the text say why, make the text say how, add the missing information, add an example, cite the source, show the derivation |
| Change | `change:simplify`, `change:shorten`, `change:expand`, `change:check`, `change:figure` | simplify, shorten, expand, check facts, numbers and equations, add or improve a figure |
| Scope (one) | `scope:phrase`, `scope:paragraph`, `scope:section` | how much of the text the request covers |
| Tone (one) | `tone:formal`, `tone:plain`, `tone:jfm` | more formal, plainer, Journal of Fluid Mechanics style |

Buttons with no note save as action `request`; with another action they refine it. An Ask means
the selected text is unclear to the reader: rewrite the text in the document so that it answers
the question, within the chosen scope and tone. Do not answer on the side; the done note says
what you changed. In the agent view:

```text
r4 L12 make the text say why; make the text say how; scope: whole paragraph | "the residual check passes"
```

The PDF quote is a rendered-text target, not a `.tex` line number. LaTeX commands, macros,
hyphenation, equations and included files can change how text appears. Check the surrounding
source before editing; an equation symbol needs its equation context and position, so do not
copy a symbol in isolation. Record the source file that actually changed. A disappeared quote
does not prove that a Delete request succeeded, and completing a task never removes its record.
Do not delete records from the sidecar to mark them done: set `applied`. While pdf-next shows the
file, it keeps the open reviews pinned to their text as you edit, and `list` then prints their
current lines.

`tools/agent_cost.mjs` measures what an agent reads in a full loop over stores of 10, 50 and 200
reviews; `node tools/agent_cost.mjs --check` fails when the 50-review loop grows past its budget.

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

Panes are the one exception, by design: a PDF shown in a pane that is not live has its own
read-only viewer and document on the same worker, so two PDFs side by side cost about what two
open PDFs cost. That viewer is torn down as soon as its pane shows another file, the tab closes
or the window goes back to one pane, and a reload destroys the document it replaces.

The Pages sidebar draws its pictures at 112 px wide, only for the pages near the view, one at
a time, and keeps at most 48 of them (under 14 MB of A4 pages on a 2x screen); closing the
sidebar or opening another file frees them all. Link previews keep the last six.

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
node tests/browser/run.mjs                        # the page in Chromium, with axe-core
bun run build && node tools/smoke.mjs             # open every fixture, for real
xvfb-run -a node tests/e2e/app.mjs                # Linux: drive the real app over WebDriver
```

`check_frontend.mjs` enforces the invariants that are easy to break silently: a real PDF.js
worker, streaming instead of whole-file reads, the canvas budget, the one-second poll, and the
mid-build gap behaviour.

`tools/smoke.mjs` launches the binary that was just built, once per file in `tests/fixtures`,
with `PDF_NEXT_SMOKE=1` in the environment. In that mode the app answers for itself: it waits
for a page to be drawn with pixels in it, then reports through a Tauri command and exits on
that answer, so a window that opens and stays empty fails the run instead of passing it.
`PDF_NEXT_SMOKE_TIMEOUT` bounds a launch that never reports; `PDF_NEXT_BIN` names a binary
somewhere else. It also prints how long the first page took to draw and how long a changed file
took to reload, and fails when either is over its budget for the platform.

`tests/browser/` runs the page in Chromium with Playwright against a mocked Tauri backend, one
file per area: PDF viewing and page colours, what a rebuild changed, Markdown rendering and
find, the outline, back and forward and link previews, zoom and remembered places, the quiet
toolbar and presentation, tabs, panes, the command palette, the review card, panel and flow,
direct edits, Settings, errors on the status line, and axe-core accessibility checks
(contrast, labels, keyboard reach) on the main views. Run `bun install` and
`bunx playwright install chromium` once first. `--coverage` also prints the line coverage of
`src/*.mjs`.

`tests/e2e/app.mjs` drives the built app itself on Linux, through `tauri-driver` and
`WebKitWebDriver` (`cargo install tauri-driver`, `apt install webkit2gtk-driver`): it opens a temp
folder with a Markdown file and a PDF, rewrites the file on disk, saves a review in the window,
and closes it with `pdf-next reviews done`. Build first with `bunx tauri build --no-bundle`.

The Rust tests include property tests (proptest) of the review store and the Markdown sanitizer.
CI prints Rust line coverage with `cargo llvm-cov --summary-only`; coverage is reported, not
enforced.

The fixtures are built by `python3 tests/make_fixtures.py`, which writes the same bytes on
every machine, so a change to them is a change someone made. The one exception is
`navigate.pdf`, a short paper with an outline and links, made by pdflatex from `navigate.tex`
beside it (the file says how).

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
| [diff-match-patch-rs](https://github.com/AnubhabB/diff-match-patch-rs) | 0.5.1 | `reviews relocate`: finds a review quote whose words were edited, near its old line. | MIT / Apache-2.0 |
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
| [Playwright](https://playwright.dev) 1.63 and [axe-core](https://github.com/dequelabs/axe-core) 4.14 | Browser tests and accessibility checks; test-only, not shipped. | Apache-2.0 / MPL-2.0 |

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
