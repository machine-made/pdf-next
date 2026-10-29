# Changelog

## 0.16.5

- Fixed apt and winget not getting new releases since 0.16.2; they were skipped whenever Windows signing was not set up

## 0.16.4

- Added panes: `Ctrl+Shift+D` splits right, `Ctrl+Shift+E` splits down, each pane has its own tabs, and tabs drag to another pane, to an edge to split, or onto a tab strip to merge
- Added `Ctrl+Alt+arrows` to move between panes; the pane you click is live and the others keep a copy, with Markdown copies following their file
- Added the panes layout to the saved session; with one pane left the plain tab strip returns
- Added buttons to the review card (Ask, Change, Scope, Tone), saved in a new `requests` field and spelled out in `{stem}_review.agent.txt`
- Added the review action `request`, for reviews made only with buttons
- Added the five Monaspace faces (Neon, Argon, Xenon, Radon, Krypton) as Markdown fonts, and a Code font setting for code blocks, inline code and the raw view
- Added scroll-wheel stepping on toolbar and Settings menus; over the zoom menu and its buttons the wheel zooms
- Changed the font menu to groups: TeX, System, Monaspace, machine-made
- Changed the split view for two Markdown files into panes that take any file kind
- Fixed `Ctrl+U` with text selected switching to the raw view when the selection could not be underlined; it now says why instead
- Windows: tab dragging uses pointer events, since the window's file drop handler swallows HTML5 drops

## 0.16.3

- Added the review action Clarify, to explain a passage better with the same facts
- Changed `Delete` with the Review panel open to open the review box; Save makes the review

## 0.16.2

- Added direct Markdown editing from the review menu: bold, italic, underline, strikethrough, code and Edit text
- Added a split view for two Markdown files
- Added figure width handles that write `{width=N%}` into the file
- Improved direct edits: whole words only, dashes and underscores inside words, nested parentheses, one-line definitions
- Fixed figure widths in quoted attributes, with units, and with more than one image in a block
- Fixed session restore of the active tab and the split view file

## 0.16.1

- Added larger Markdown text sizes: 26, 28, 32, 36, 40 and 48 px
- Added the mouse wheel over the tab strip to switch tabs, wrapping at the ends

## 0.16.0

- Added `{stem}_review.agent.txt`, a short view of the open reviews for agents, and the `{stem}_review.done` inbox
- Added `pdf-next reviews brief`, `done` and `restore`
- Added review actions Polish, Shorten, Expand, Check, Bold, Italic and Delete, and direct edits to Markdown
- Added Markdown figures with captions, numbering, sizes and Settings
- Added the machine-made fonts Weft, Sans and Heddle, Settings (`Ctrl+,`) and About
- Added undo for a removed review (`Ctrl+Z`)
- Changed the name to "pdf-next by machine-made"
- Fixed review marks moving off their text while an agent edits the file
- Fixed the review box not closing from anywhere; Esc, × and Cancel now close it
- Fixed a reworded quote at the end of a paragraph not being found

## 0.15.1

- Added Markdown math with math-core, local images, colour for fenced code, find, and page view (continuous, single page, two pages)
- Added Markdown reviews: located by surrounding text, flagged when made on an older version, Reattach, and the reviews CLI for Markdown
- Added a page view menu for PDF: single page or two pages
- Added Markdown font, text size and column width menus, and links for headings and bare web addresses
- Changed the Windows installer to include the WebView2 bootstrapper instead of downloading it
- Fixed an equation that failed to convert closing the window
- Fixed Markdown images on network shares being read; they are now refused
- Windows: bundles are scanned with Defender before a release is shown

## 0.14.5

- Added web links in a PDF, opened in the system browser
- Fixed a fit-width page not rendering whole on 4K screens
- Fixed text selection for copying outside review mode
- Fixed `mailto:` links in documents being followed

## 0.14.4

- Added the `Delete` key to move the file on screen to the trash, asking first where there is no trash
- Changed stepping through a folder to fill the window with each figure

## 0.14.3

- Fixed an opened figure larger than the screen not fitting its window

## 0.14.2

- Fixed a figure larger than the screen opening at 100% instead of whole

## 0.14.1

- Fixed comment edits made while a save was running being lost
- Fixed PDF quotes that cross a split in the PDF.js text not being found
- Fixed a PDF quote matching inside a longer word

## 0.14.0

- Added PDF review actions (Improve, Delete selection), 16 colours, stable review IDs, and filters by action and status
- Added review status from open to applied to resolved; applied PDF requests need a successful build
- Added `pdf-next reviews list` and `update` for agents, with revision checks and a dry run
- Added optional SyncTeX source hints
- Fixed false comment-save conflicts and wrong matches of repeated text

## 0.13.2

- Improved PDF rendering on high-density displays with PDF.js 6.3

## 0.13.1

- Fixed blurred PDF pages after moving the window between displays with different scaling
- Fixed unsaved review notes being lost on reload
- Fixed review saves on Windows with an atomic rename

## 0.13.0

- Added Reduce PDF, which writes a smaller `name_reduced.pdf`
- Fixed reinstalling over a pinned Windows install

## 0.12.2

- Added live reload of the review JSON, Enter to comment, and a review text size

## 0.12.1

- Added a one-click Windows setup, copy path, and commenting on the selection

## 0.12.0

- Added review numbers (1.1, 1.2), and adding a review from the selection
- Fixed the review panel changing the typeface

## 0.11.0

- Added the Review panel, a review file per document, and marks you can come back to

## 0.10.0

- Added Ask and Notes, written as one record in `_review.json`

## 0.9.3

- Windows: fixed finding a previous install after the publisher changed

## 0.9.2

- macOS: fixed a Finder drop that only carries a file URL

## 0.9.1

- Added Homebrew and apt packages, and winget manifests
- Changed releases to stay drafts until their bundles open a document in CI

## 0.9.0

- Added opening at a page or at a figure from the command line

## 0.8.0

- Added typeset equations, and links that go somewhere

## 0.7.2

- Fixed scanned pages not showing

## 0.7.1

- Added a notice at launch when a newer version exists

## 0.7.0

- Added rotating an image

## 0.6.2

- Added printing through the system's own dialog

## 0.6.1

- Changed every dock position to fit the width

## 0.6.0

- Added Markdown files, five-way docking, and a command line other programs can use

## 0.5.1

- Fixed leaving a page mode

## 0.5.0

- Added fitting the window to the content, and tabs that keep only the shown file in memory

## 0.4.0

- Added stepping through a folder of images with the arrow keys

## 0.3.1

- Added command-line flags for appearance, docking and the watch interval

## 0.3.0

- Fixed a memory leak of about 77 MB per reload
- Improved security hardening

## 0.2.1

- Changed docking to a toggle: fit width when docked, auto fit when not

## 0.2.0

- Added a small empty window, an exact fit, remembered sizes and a reload interval

## 0.1.1

- Added fitting the window to the document and docking to the left half

## 0.1.0

- Added pdf-next: a small PDF and PNG viewer that reloads within a second when the file changes
