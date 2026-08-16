// Drawings of the real things, in one stroke vocabulary so they read as a set.
// A labelled box asks the visitor to accept an abstraction; an icon they can
// open asks them to form one.
//
// Each is authored on a 24x24 grid and scaled at draw time. Every path is
// stroked in currentColor, so the theme is inherited rather than restated.

import type { IconName } from "./layout.js";

export const ICON_GRID = 24;

// Two cylinders on purpose: .git and the server hold the same kind of thing,
// and drawing them identically apart from the dotted border is the argument
// for why push is a copy rather than an upload.
const CYLINDER = [
  "M4 6.5c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5-8-1.1-8-2.5z",
  "M4 6.5v11c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-11",
  "M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5",
].join(" ");

const LAPTOP = [
  "M5 5.5h14v9H5z", // the screen
  "M2.5 17.5h19l-1.5 2h-16z", // the base, in perspective
].join(" ");

const FOLDER = [
  "M3 6.5h6l1.5 2H21v11H3z", // the folder itself
  "M7 12h9M7 15.5h6", // sheets of paper inside it
].join(" ");

// A manifest of what goes in next, not a place files live. Looking unlike the
// folder is what stops the commonest confusion in the whole subject.
const CHECKLIST = [
  "M6 3.5h12v17H6z",
  "M9 8l1.6 1.6L13.5 6.5", // a tick
  "M9 13.5h6M9 17h4",
].join(" ");

export const ICONS: Record<IconName, string> = {
  cylinder: CYLINDER,
  laptop: LAPTOP,
  folder: FOLDER,
  checklist: CHECKLIST,
};
