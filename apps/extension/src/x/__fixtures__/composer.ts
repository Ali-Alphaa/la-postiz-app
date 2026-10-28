// Simplified markup of the x.com web composer and of its schedule dialog,
// written from what x.com used in 2026. NOT verified against the live site:
// update it (and the selectors) when X changes.

export const composerHtml = (submitLabel = 'Post') => `
<div role="dialog" aria-modal="true" aria-labelledby="modal-header">
  <div class="DraftEditor-root">
    <div class="public-DraftEditor-content" contenteditable="true" role="textbox"
         data-testid="tweetTextarea_0" aria-label="Post text" spellcheck="true">
      <div data-contents="true"><div data-block="true"><span data-text="true"></span></div></div>
    </div>
  </div>
  <div role="tablist" data-testid="toolBar">
    <button type="button" aria-label="Add photos or video"></button>
    <button type="button" role="button" aria-label="Schedule post" data-testid="scheduleOption"></button>
  </div>
  <button type="button" role="button" data-testid="tweetButton">
    <div dir="ltr"><span><span>${submitLabel}</span></span></div>
  </button>
</div>`;

const options = (values: Array<[string, string]>) =>
  values
    .map(([value, text]) => `<option value="${value}">${text}</option>`)
    .join('');

const range = (from: number, to: number, pad = false) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const value = String(from + i);
    return [value, pad ? value.padStart(2, '0') : value] as [string, string];
  });

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const field = (id: string, label: string, opts: string) => `
  <div>
    <label for="SELECTOR_${id}"><span id="SELECTOR_${id}_LABEL">${label}</span></label>
    <select id="SELECTOR_${id}" aria-invalid="false" aria-labelledby="SELECTOR_${id}_LABEL">${opts}</select>
  </div>`;

// twelveHour: an English (US) account; false: a 24-hour locale
export const scheduleDialogHtml = (twelveHour = true, withLabels = true) => `
<div role="dialog" aria-modal="true" aria-labelledby="schedule-header">
  <h2 id="schedule-header">Schedule</h2>
  <div role="group" aria-label="Date">
    ${field(
      '1',
      withLabels ? 'Month' : '',
      options(MONTHS.map((m, i) => [String(i + 1), m]))
    )}
    ${field('2', withLabels ? 'Day' : '', options(range(1, 31)))}
    ${field('3', withLabels ? 'Year' : '', options(range(2026, 2028)))}
  </div>
  <div role="group" aria-label="Time">
    ${field(
      '4',
      withLabels ? 'Hour' : '',
      options(twelveHour ? range(1, 12) : range(0, 23))
    )}
    ${field('5', withLabels ? 'Minute' : '', options(range(0, 59, true)))}
    ${
      twelveHour
        ? field(
            '6',
            withLabels ? 'AM/PM' : '',
            options([
              ['AM', 'AM'],
              ['PM', 'PM'],
            ])
          )
        : ''
    }
  </div>
  <div>Will send on Wed, Oct 28, 2026 at 3:00 PM</div>
  <button type="button" role="button" data-testid="scheduledConfirmationPrimaryAction"><span>Confirm</span></button>
</div>`;
