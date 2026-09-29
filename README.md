# Local Web Annotator

Local Web Annotator is a **local-first browser extension** for annotating webpages.  
It allows you to:

- highlight text,
- add comments to highlights,
- place graphic sticky-note annotations,
- organize annotations into named sets,
- save/load annotations as local JSON files,
- recover annotations even when webpage text moves or changes.

It is especially useful for webpages with **instruction panels**, **internal tabs**, and **changing content**.

### Advantages over other (semi) free annotators like Hypothesis: Highlighting something does not automatically close the SF instructions panel.
#### If you do not know what SF is, this is not for you.

---

# Table of Contents

1. [What this tool does](#what-this-tool-does)
2. [Features](#features)
3. [Installation](#installation)
   - [Step 1: Download or clone](#step-1-download-or-clone)
   - [Step 2: Open browser extensions page](#step-2-open-browser-extensions-page)
   - [Step 3: Turn on Developer mode](#step-3-turn-on-developer-mode)
   - [Step 4: Load unpacked extension](#step-4-load-unpacked-extension)
4. [How to use the extension](#how-to-use-the-extension)
   - [Open the toolbar](#open-the-toolbar)
   - [Move the toolbar](#move-the-toolbar)
   - [Choose annotation sets](#choose-annotation-sets)
   - [Create highlights](#create-highlights)
   - [Add comments to highlights](#add-comments-to-highlights)
   - [Create sticky-note annotations](#create-sticky-note-annotations)
   - [Move sticky notes](#move-sticky-notes)
   - [Use the issues/annotation panel](#use-the-issues--annotation-panel)
5. [Toolbar explanation](#toolbar-explanation)
6. [Popup menu explanation](#popup-menu-explanation)
7. [Folder save/load workflow](#folder-saveload-workflow)
8. [When webpage text changes](#when-webpage-text-changes)
9. [Keyboard shortcuts](#keyboard-shortcuts)
10. [Recommended workflow](#recommended-workflow)
11. [Repository contents](#repository-contents)
12. [Notes and limitations](#notes-and-limitations)

---

# What this tool does

Many webpages contain instruction panels or multiple internal tabs, where the same phrase may appear in different places. This extension helps keep annotations organized by allowing you to create **annotation sets**.

For example, the same webpage can have different sets such as:

- `Default`
- `Step-by-Step Workflow`
- `Project Overview`
- `Prompt Writing Guidelines`
- `Rubric Writing Guidelines`
- `Law`
- `Medicine`
- `Pure Math`

Each set can have its own independent:

- highlights,
- comments,
- sticky notes,
- colors.

This avoids mixing annotations from different instruction tabs.

---

# Features

- Text highlighting
- Highlight comments
- Graphic sticky-note annotations
- Multiple annotation sets
- Local JSON save/load
- One JSON file per set
- Local-first workflow
- Recovery when webpage text changes
- Issue review / candidate navigation
- Movable toolbar
- Temporarily movable comment boxes

---

# Installation

## Step 1: Download or clone

Download or clone this repository.

You should have a folder containing files such as:

```text
manifest.json
content.js
content.css
popup.html
popup.js
popup.css
background.js
README.md
```

## Installation Screenshots

### 1. Open the extensions page

![Open extensions page](docs/images/install-1-extension-page.png)

### 2. Enable Developer mode

![Enable Developer mode](docs/images/install-2-developer-mode.png)

### 3. Load the unpacked extension

![Load unpacked extension](docs/images/install-3-load-unpacked.png)

### 4. Confirm the extension is loaded

![Extension loaded](docs/images/install-4-extension-loaded.png)
