// Puts one post into X's own scheduler (X Premium web composer), in the x.com
// tab, only when the user started a sync from the extension. It never
// publishes: before the last click it checks that the composer button says
// "Schedule", and gives up when it would post right away.
//
// The selectors below are written from what x.com's web composer used in
// 2026 and could not be checked against the live site from where this was
// built: each one has fallbacks, and every step fails with a message
// instead of guessing.

export const COMPOSE_URL = 'https://x.com/compose/post';

export const SELECTORS = {
  // the DraftJS editor of the composer
  editor: [
    '[data-testid="tweetTextarea_0"][contenteditable="true"]',
    '[data-testid="tweetTextarea_0"] [contenteditable="true"]',
    '[role="dialog"] [role="textbox"][contenteditable="true"]',
  ],
  // the calendar icon of the composer toolbar
  scheduleOption: [
    '[data-testid="scheduleOption"]',
    '[role="button"][aria-label="Schedule post"]',
    'button[aria-label="Schedule post"]',
    '[role="button"][aria-label="Schedule"]',
  ],
  // "Confirm" of the schedule dialog
  confirm: ['[data-testid="scheduledConfirmationPrimaryAction"]'],
  // the main button of the composer: "Post", or "Schedule" once a date is set
  submit: ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]'],
};

export type ScheduleField =
  | 'month'
  | 'day'
  | 'year'
  | 'hour'
  | 'minute'
  | 'ampm';

// how the selects of the schedule dialog are labelled
const FIELD_LABELS: Array<[ScheduleField, RegExp]> = [
  ['month', /month/i],
  ['day', /^day$|\bday\b/i],
  ['year', /year/i],
  ['hour', /hour/i],
  ['minute', /minute/i],
  ['ampm', /am\s*\/\s*pm|period|meridi/i],
];

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

export interface ScheduleValues {
  month: number;
  day: number;
  year: number;
  // 1-12 with ampm, or 0-23 without
  hour: number;
  minute: number;
  ampm?: 'AM' | 'PM';
}

// the values to pick in the dialog, in the time zone of the browser (X
// shows the dialog in local time)
export const scheduleValues = (
  isoUtc: string,
  use12h: boolean,
  timeZone?: string
): ScheduleValues => {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, parseInt(p.value, 10)])
  ) as Record<string, number>;

  // some engines print midnight as 24 with h23
  const hour23 = parts.hour % 24;
  return {
    month: parts.month,
    day: parts.day,
    year: parts.year,
    minute: parts.minute,
    ...(use12h
      ? { hour: hour23 % 12 || 12, ampm: hour23 < 12 ? 'AM' : 'PM' }
      : { hour: hour23 }),
  };
};

// X refuses times that are too close; leave room for the sync itself
export const MIN_LEAD_MS = 5 * 60 * 1000;
export const isSchedulable = (isoUtc: string, now = Date.now()) => {
  const time = new Date(isoUtc).getTime();
  return !Number.isNaN(time) && time - now >= MIN_LEAD_MS;
};

const normalize = (text: string) =>
  text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export const sameText = (a: string, b: string) => normalize(a) === normalize(b);

// "Schedule" (English UI); anything that reads as an immediate post is not
export const isScheduleLabel = (label: string) => {
  const value = normalize(label).toLowerCase();
  return /^schedule\b/.test(value) && !/^post\b|post all|^reply/.test(value);
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export const find = <T extends Element = HTMLElement>(
  root: ParentNode,
  selectors: string[]
): T | null => {
  for (const selector of selectors) {
    const element = root.querySelector<T>(selector);
    if (element) {
      return element;
    }
  }
  return null;
};

const labelOf = (select: HTMLSelectElement) => {
  const doc = select.ownerDocument;
  const byId = (ids: string | null) =>
    (ids || '')
      .split(/\s+/)
      .map((id) => (id ? doc.getElementById(id)?.textContent || '' : ''))
      .join(' ');
  return normalize(
    [
      select.getAttribute('aria-label') || '',
      byId(select.getAttribute('aria-labelledby')),
      ...Array.from(select.labels || []).map((p) => p.textContent || ''),
    ].join(' ')
  );
};

// the selects of the dialog by field: by their label, else by position
// (month, day, year, hour, minute, AM/PM)
export const scheduleSelects = (dialog: ParentNode) => {
  const selects = Array.from(dialog.querySelectorAll('select'));
  const fields: Partial<Record<ScheduleField, HTMLSelectElement>> = {};

  for (const select of selects) {
    const label = labelOf(select);
    const match = FIELD_LABELS.find(
      ([field, regex]) => !fields[field] && regex.test(label)
    );
    if (match) {
      fields[match[0]] = select;
    }
  }

  if (
    Object.keys(fields).length < 5 &&
    (selects.length === 5 || selects.length === 6)
  ) {
    const order: ScheduleField[] = [
      'month',
      'day',
      'year',
      'hour',
      'minute',
      'ampm',
    ];
    selects.forEach((select, index) => {
      fields[order[index]] = select;
    });
  }

  return fields;
};

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

// the option for a value: by value, else by its text
export const findOption = (
  select: HTMLSelectElement,
  field: ScheduleField,
  value: number | string
) => {
  const options = Array.from(select.options);
  const wanted = String(value).toLowerCase();
  return (
    options.find((p) => p.value.toLowerCase() === wanted) ||
    options.find(
      (p) => p.value !== '' && !Number.isNaN(+p.value) && +p.value === +value
    ) ||
    options.find((p) => {
      const text = normalize(p.textContent || '').toLowerCase();
      if (field === 'month' && typeof value === 'number') {
        return (
          text === MONTHS[value - 1] || text === MONTHS[value - 1].slice(0, 3)
        );
      }
      return text === wanted || (+text === +value && text !== '');
    }) ||
    null
  );
};

// React keeps its own copy of a select's value: set it through the native
// setter and announce it, like a user choice
export const setSelectValue = (select: HTMLSelectElement, value: string) => {
  const view = select.ownerDocument.defaultView as any;
  const setter = Object.getOwnPropertyDescriptor(
    view?.HTMLSelectElement?.prototype || HTMLSelectElement.prototype,
    'value'
  )?.set;
  if (setter) {
    setter.call(select, value);
  } else {
    select.value = value;
  }
  select.dispatchEvent(new view.Event('input', { bubbles: true }));
  select.dispatchEvent(new view.Event('change', { bubbles: true }));
};

export const fillScheduleDialog = (dialog: ParentNode, isoUtc: string) => {
  const selects = scheduleSelects(dialog);
  for (const field of ['month', 'day', 'year', 'hour', 'minute'] as const) {
    if (!selects[field]) {
      throw new Error(`The schedule dialog has no ${field} field`);
    }
  }

  const values = scheduleValues(isoUtc, !!selects.ampm);
  // the date first: the hours offered can depend on the day
  for (const field of [
    'year',
    'month',
    'day',
    'ampm',
    'hour',
    'minute',
  ] as const) {
    const select = selects[field];
    const value = values[field];
    if (!select || value === undefined) {
      continue;
    }
    const option = findOption(select, field, value);
    if (!option) {
      throw new Error(`The schedule dialog has no ${field} "${value}"`);
    }
    setSelectValue(select, option.value);
    if (select.value !== option.value) {
      throw new Error(`The ${field} of the schedule dialog could not be set`);
    }
  }
  return values;
};

// ---------------------------------------------------------------------------
// The whole sequence for one post
// ---------------------------------------------------------------------------

export interface NativeItem {
  id: string;
  text: string;
  scheduledAt: string;
  // the X account it is for (lowercase); null: any account
  handle?: string | null;
}

// The posts of another X account than the one signed in on x.com are left
// for a later sync (never claimed); posts without account go with any
export const splitByAccount = (
  items: NativeItem[],
  loggedIn: string | null
) => {
  const current = (loggedIn || '').toLowerCase();
  const run: NativeItem[] = [];
  const other: NativeItem[] = [];
  for (const item of items) {
    if (item.handle && item.handle.toLowerCase() !== current) {
      other.push(item);
    } else {
      run.push(item);
    }
  }
  return {
    run,
    skipped: other.length,
    handles: [...new Set(other.map((p) => p.handle!.toLowerCase()))],
  };
};

export const wrongAccountMessage = (skipped: number, handles: string[]) =>
  skipped
    ? `${skipped} post${
        skipped > 1 ? 's' : ''
      } skipped — switch x.com to ${handles
        .map((p) => `@${p}`)
        .join(' or ')} and sync again`
    : '';

export interface NativeResult {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
}

export interface RunOptions {
  dryRun: boolean;
  sleep?: (ms: number) => Promise<void>;
  // ms to wait for each element
  timeout?: number;
  shouldStop?: () => boolean;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitFor = async <T>(
  check: () => T | null | undefined | false,
  timeout: number,
  sleep: (ms: number) => Promise<void>
): Promise<T | null> => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = check();
    if (value) {
      return value;
    }
    if (Date.now() >= end) {
      return null;
    }
    await sleep(200);
  }
};

const click = (element: Element) => {
  (element as HTMLElement).click();
};

// DraftJS takes text typed through the editing commands of the browser;
// a paste is the fallback
const insertText = (doc: Document, editor: HTMLElement, text: string) => {
  editor.focus();
  doc.execCommand?.('selectAll', false);
  const inserted = doc.execCommand?.('insertText', false, text);
  if (inserted && sameText(editor.textContent || '', text)) {
    return true;
  }

  const view = doc.defaultView as any;
  if (view?.DataTransfer && view?.ClipboardEvent) {
    const data = new view.DataTransfer();
    data.setData('text/plain', text);
    editor.dispatchEvent(
      new view.ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }
  return sameText(editor.textContent || '', text);
};

export const scheduleOne = async (
  doc: Document,
  item: NativeItem,
  options: RunOptions
): Promise<NativeResult> => {
  const sleep = options.sleep || defaultSleep;
  const timeout = options.timeout ?? 15000;
  const stopped = () => !!options.shouldStop?.();

  if (!isSchedulable(item.scheduledAt)) {
    return { ok: false, error: 'The time is too close or already passed' };
  }

  const editor = await waitFor(
    () => find<HTMLElement>(doc, SELECTORS.editor),
    timeout,
    sleep
  );
  if (!editor) {
    return {
      ok: false,
      error: 'The X composer did not open (are you signed in?)',
    };
  }
  if (stopped()) {
    return { ok: false, error: 'Stopped' };
  }

  if (!insertText(doc, editor, item.text)) {
    return {
      ok: false,
      error: 'The text could not be typed into the X composer',
    };
  }
  await sleep(500);

  const scheduleButton = await waitFor(
    () => find(doc, SELECTORS.scheduleOption),
    timeout,
    sleep
  );
  if (!scheduleButton) {
    return {
      ok: false,
      error: 'The schedule button of X was not found (X Premium is needed)',
    };
  }
  click(scheduleButton);

  const confirm = await waitFor(
    () => find(doc, SELECTORS.confirm),
    timeout,
    sleep
  );
  if (!confirm) {
    return { ok: false, error: 'The schedule dialog of X did not open' };
  }
  const dialog = confirm.closest('[role="dialog"]') || doc;
  try {
    fillScheduleDialog(dialog, item.scheduledAt);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  await sleep(300);
  if (stopped()) {
    return { ok: false, error: 'Stopped' };
  }
  click(confirm);

  // the composer now offers "Schedule" instead of "Post"
  const submit = await waitFor(
    () => {
      const button = find(doc, SELECTORS.submit);
      return button && isScheduleLabel(button.textContent || '')
        ? button
        : null;
    },
    timeout,
    sleep
  );
  if (!submit) {
    const label = normalize(find(doc, SELECTORS.submit)?.textContent || '');
    return {
      ok: false,
      error: label
        ? `Aborted: the X button says "${label}", not "Schedule" (use X in English)`
        : 'The Schedule button of X was not found',
    };
  }
  if (
    !sameText(
      find<HTMLElement>(doc, SELECTORS.editor)?.textContent || '',
      item.text
    )
  ) {
    return { ok: false, error: 'The text changed in the composer, aborted' };
  }

  if (options.dryRun) {
    return { ok: true, dryRun: true };
  }
  if (stopped()) {
    return { ok: false, error: 'Stopped' };
  }
  if (
    (submit as HTMLButtonElement).disabled ||
    submit.getAttribute('aria-disabled') === 'true'
  ) {
    return { ok: false, error: 'X does not accept this post (too long?)' };
  }

  click(submit);

  // the composer closes once X took the post
  const closed = await waitFor(
    () => !find(doc, SELECTORS.editor),
    timeout,
    sleep
  );
  return closed
    ? { ok: true }
    : { ok: false, error: 'X did not confirm the scheduled post' };
};
