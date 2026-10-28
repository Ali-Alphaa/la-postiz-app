/// <reference types="jest" />
import { JSDOM } from 'jsdom';
import {
  fillScheduleDialog,
  findOption,
  isSchedulable,
  isScheduleLabel,
  NativeItem,
  scheduleOne,
  scheduleSelects,
  scheduleValues,
  splitByAccount,
  wrongAccountMessage,
} from './native.scheduler';
import { badgeFor } from './badge';
import { composerHtml, scheduleDialogHtml } from './__fixtures__/composer';

const dom = () => new JSDOM('<!doctype html><body></body>').window;

describe('scheduleValues', () => {
  it('converts UTC to the local select values, 12h', () => {
    expect(
      scheduleValues('2026-10-28T19:05:00.000Z', true, 'America/New_York')
    ).toEqual({
      month: 10,
      day: 28,
      year: 2026,
      hour: 3,
      minute: 5,
      ampm: 'PM',
    });
    expect(
      scheduleValues('2026-10-28T04:30:00.000Z', true, 'America/New_York')
    ).toEqual({
      month: 10,
      day: 28,
      year: 2026,
      hour: 12,
      minute: 30,
      ampm: 'AM',
    });
    expect(
      scheduleValues('2026-10-28T16:00:00.000Z', true, 'UTC')
    ).toMatchObject({
      hour: 4,
      ampm: 'PM',
    });
    expect(
      scheduleValues('2026-10-28T12:00:00.000Z', true, 'UTC')
    ).toMatchObject({
      hour: 12,
      ampm: 'PM',
    });
  });

  it('converts to 24h and crosses the date line', () => {
    expect(
      scheduleValues('2026-12-31T23:30:00.000Z', false, 'Asia/Karachi')
    ).toEqual({
      month: 1,
      day: 1,
      year: 2027,
      hour: 4,
      minute: 30,
    });
    expect(scheduleValues('2026-10-28T00:00:00.000Z', false, 'UTC').hour).toBe(
      0
    );
    expect(() => scheduleValues('nope', true)).toThrow();
  });

  it('needs a time at least 5 minutes ahead', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(isSchedulable('2026-10-28T12:05:00Z', now)).toBe(true);
    expect(isSchedulable('2026-10-28T12:04:59Z', now)).toBe(false);
    expect(isSchedulable('bad', now)).toBe(false);
  });

  it('recognizes the Schedule button only', () => {
    expect(isScheduleLabel(' Schedule ')).toBe(true);
    expect(isScheduleLabel('Post')).toBe(false);
    expect(isScheduleLabel('Post all')).toBe(false);
    expect(isScheduleLabel('Programmer')).toBe(false);
  });
});

describe('schedule dialog', () => {
  it('finds the selects by label and sets them', () => {
    const window = dom();
    window.document.body.innerHTML = scheduleDialogHtml(true);
    const selects = scheduleSelects(window.document);
    expect(Object.keys(selects).sort()).toEqual(
      ['ampm', 'day', 'hour', 'minute', 'month', 'year'].sort()
    );

    const changes: string[] = [];
    window.document.addEventListener('change', (e) =>
      changes.push((e.target as HTMLSelectElement).id)
    );
    const iso = new Date(2026, 10, 3, 21, 7).toISOString(); // local 9:07 PM
    fillScheduleDialog(window.document, iso);
    expect(selects.month!.value).toBe('11');
    expect(selects.day!.value).toBe('3');
    expect(selects.year!.value).toBe('2026');
    expect(selects.hour!.value).toBe('9');
    expect(selects.minute!.value).toBe('7');
    expect(selects.ampm!.value).toBe('PM');
    expect(changes).toHaveLength(6);
  });

  it('falls back to the order of the selects and handles 24h', () => {
    const window = dom();
    window.document.body.innerHTML = scheduleDialogHtml(false, false);
    const selects = scheduleSelects(window.document);
    expect(selects.ampm).toBeUndefined();
    fillScheduleDialog(
      window.document,
      new Date(2027, 0, 15, 18, 45).toISOString()
    );
    expect(selects.hour!.value).toBe('18');
    expect(selects.minute!.value).toBe('45');
    expect(selects.year!.value).toBe('2027');
  });

  it('matches options by text when values differ', () => {
    const window = dom();
    window.document.body.innerHTML =
      '<select id="m"><option value="jan">Jan</option><option value="nov">November</option></select>';
    const select = window.document.querySelector('select')!;
    expect(findOption(select, 'month', 11)?.value).toBe('nov');
    expect(findOption(select, 'month', 1)?.value).toBe('jan');
  });

  it('fails clearly when a year is not offered', () => {
    const window = dom();
    window.document.body.innerHTML = scheduleDialogHtml(true);
    expect(() =>
      fillScheduleDialog(
        window.document,
        new Date(2030, 0, 1, 10, 0).toISOString()
      )
    ).toThrow(/year/);
  });
});

// a fake x.com that behaves like the composer
const fakeX = (
  options: { submitLabelAfterSchedule?: string; closeOnSubmit?: boolean } = {}
) => {
  const window = dom();
  const doc = window.document;
  doc.body.innerHTML = composerHtml('Post');
  const clicks: string[] = [];

  (doc as any).execCommand = (
    command: string,
    _ui: boolean,
    value?: string
  ) => {
    if (command === 'insertText') {
      doc.querySelector('[data-testid="tweetTextarea_0"]')!.textContent =
        value || '';
      return true;
    }
    return command === 'selectAll';
  };

  doc.addEventListener('click', (event) => {
    const target = (event.target as Element).closest('[data-testid]');
    const id = target?.getAttribute('data-testid') || '';
    clicks.push(id);
    if (id === 'scheduleOption') {
      doc.body.insertAdjacentHTML('beforeend', scheduleDialogHtml(true));
    }
    if (id === 'scheduledConfirmationPrimaryAction') {
      target!.closest('[role="dialog"]')!.remove();
      doc.querySelector('[data-testid="tweetButton"] span span')!.textContent =
        options.submitLabelAfterSchedule ?? 'Schedule';
    }
    if (id === 'tweetButton' && options.closeOnSubmit !== false) {
      doc.body.innerHTML = '';
    }
  });

  return { doc, clicks };
};

const item = (minutes = 120): NativeItem => ({
  id: 'n1',
  text: 'Cut losers fast.\nLet winners run.',
  scheduledAt: new Date(Date.now() + minutes * 60000).toISOString(),
});

const fast = { sleep: async () => {}, timeout: 50 };

describe('scheduleOne', () => {
  it('types, schedules and clicks Schedule', async () => {
    const { doc, clicks } = fakeX();
    expect(await scheduleOne(doc, item(), { dryRun: false, ...fast })).toEqual({
      ok: true,
    });
    expect(clicks).toEqual([
      'scheduleOption',
      'scheduledConfirmationPrimaryAction',
      'tweetButton',
    ]);
  });

  it('stops before the last click in a dry run', async () => {
    const { doc, clicks } = fakeX();
    expect(await scheduleOne(doc, item(), { dryRun: true, ...fast })).toEqual({
      ok: true,
      dryRun: true,
    });
    expect(clicks).not.toContain('tweetButton');
    expect(
      doc.querySelector('[data-testid="tweetTextarea_0"]')!.textContent
    ).toBe(item().text);
  });

  it('never clicks a button that would post right away', async () => {
    const { doc, clicks } = fakeX({ submitLabelAfterSchedule: 'Post' });
    const result = await scheduleOne(doc, item(), { dryRun: false, ...fast });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/says "Post"/);
    expect(clicks).not.toContain('tweetButton');
  });

  it('reports when X does not take the post', async () => {
    const { doc } = fakeX({ closeOnSubmit: false });
    expect(
      await scheduleOne(doc, item(), { dryRun: false, ...fast })
    ).toMatchObject({
      ok: false,
      error: 'X did not confirm the scheduled post',
    });
  });

  it('fails without the composer, the schedule option or a valid time', async () => {
    const window = dom();
    expect(
      (await scheduleOne(window.document, item(), { dryRun: false, ...fast }))
        .error
    ).toMatch(/composer did not open/);

    const { doc } = fakeX();
    doc.querySelector('[data-testid="scheduleOption"]')!.remove();
    expect(
      (await scheduleOne(doc, item(), { dryRun: false, ...fast })).error
    ).toMatch(/Premium/);

    expect(
      (await scheduleOne(fakeX().doc, item(1), { dryRun: false, ...fast }))
        .error
    ).toMatch(/too close/);
  });

  it('can be stopped', async () => {
    const { doc, clicks } = fakeX();
    const result = await scheduleOne(doc, item(), {
      dryRun: false,
      ...fast,
      shouldStop: () => true,
    });
    expect(result).toEqual({ ok: false, error: 'Stopped' });
    expect(clicks).toEqual([]);
  });
});

describe('badgeFor', () => {
  it('shows the pending posts first, then the saved tweets', () => {
    expect(badgeFor({ pending: 3, savedToday: 9 })).toEqual({
      text: '3',
      color: '#F97316',
    });
    expect(badgeFor({ pending: 0, savedToday: 9 })).toEqual({
      text: '9',
      color: '#612BD3',
    });
    expect(badgeFor({ pending: 0, savedToday: 0 }).text).toBe('');
    expect(badgeFor({ pending: 120, savedToday: 0 }).text).toBe('99+');
  });
});

describe('splitByAccount', () => {
  const post = (id: string, handle?: string | null) => ({
    id,
    text: id,
    scheduledAt: '2026-11-01T10:00:00Z',
    handle,
  });

  it('keeps the posts of the signed-in account and those without account', () => {
    const split = splitByAccount(
      [
        post('a', 'sigma'),
        post('b', 'other_acc'),
        post('c'),
        post('d', 'other_acc'),
        post('e', 'third'),
      ],
      'Sigma'
    );
    expect(split.run.map((p) => p.id)).toEqual(['a', 'c']);
    expect(split.skipped).toBe(3);
    expect(split.handles).toEqual(['other_acc', 'third']);
    expect(wrongAccountMessage(split.skipped, split.handles)).toBe(
      '3 posts skipped — switch x.com to @other_acc or @third and sync again'
    );
    expect(wrongAccountMessage(0, [])).toBe('');
  });

  it('skips every post with an account when nobody is signed in', () => {
    const split = splitByAccount([post('a', 'sigma'), post('b', null)], null);
    expect(split.run.map((p) => p.id)).toEqual(['b']);
    expect(wrongAccountMessage(split.skipped, split.handles)).toBe(
      '1 post skipped — switch x.com to @sigma and sync again'
    );
  });
});
