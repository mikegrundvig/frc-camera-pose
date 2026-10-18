// What the field drawing shows. These are one viewer's own choices, kept in this browser's local
// storage and not in the shared link: someone opening your link sees their own.

// The things that can be shown or hidden, in the order the page lists them, with what is on at
// first. Hidden things still count: field elements and other robots block the cameras' view
// whether or not they are drawn.
export const SHOW_ITEMS = [
  { id: 'views', label: 'Camera views', on: true },
  { id: 'seenLines', label: 'Seen tag lines', on: true },
  { id: 'hiddenLines', label: 'Hidden tag lines', on: false },
  { id: 'tagNumbers', label: 'Tag numbers', on: true },
  { id: 'elements', label: 'Field elements', on: true },
  { id: 'others', label: 'Other robots', on: true },
  { id: 'map', label: 'Coverage map', on: true },
  { id: 'blend', label: 'Blend map', on: true },
];

const KEY = 'show';

export function defaultShow() {
  return Object.fromEntries(SHOW_ITEMS.map((item) => [item.id, item.on]));
}

// The choices from saved text, anything missing or not true or false taken from the defaults.
export function showFromText(text) {
  const show = defaultShow();
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return show;
  }
  if (!raw || typeof raw !== 'object') return show;
  for (const item of SHOW_ITEMS) {
    if (typeof raw[item.id] === 'boolean') show[item.id] = raw[item.id];
  }
  return show;
}

// The saved choices, or the defaults when nothing is saved or storage is off.
export function loadShow() {
  try {
    return showFromText(localStorage.getItem(KEY));
  } catch {
    return defaultShow();
  }
}

export function saveShow(show) {
  try {
    localStorage.setItem(KEY, JSON.stringify(show));
  } catch {
    // Storage may be off; the choices just aren't remembered.
  }
}
