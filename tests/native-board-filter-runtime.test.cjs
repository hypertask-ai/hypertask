const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
});
const {
  calculateDynamicDateRange,
  defaultConditions,
  formatDateDisplay,
  renderDynamicDateRange,
} = jiti(
  path.join(root, 'src/utils/helperFunctions/Views/FilterHelperFunctions.ts'),
);

const duePayload = (dynamicRange) => [{
  fromDate: null,
  toDate: null,
  condition: null,
  selectedDate: null,
  dynamicRange,
}];

test('native status filters match the persisted task status', () => {
  assert.equal(defaultConditions.Status({ status: 'Normal' }, [{ value: 'Normal' }]), true);
  assert.equal(defaultConditions.Status({ status: 'Archive' }, [{ value: 'Normal' }]), false);
});

test('native due-date ranges cover overdue, next seven days, and no due date', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const eighthCalendarDay = new Date();
  eighthCalendarDay.setDate(eighthCalendarDay.getDate() + 7);

  assert.equal(defaultConditions.DueDate({ dueDate: yesterday.toISOString() }, duePayload('OVERDUE')), true);
  assert.equal(defaultConditions.DueDate({ dueDate: tomorrow.toISOString() }, duePayload('NEXT_7_DAYS')), true);
  assert.equal(defaultConditions.DueDate({ dueDate: eighthCalendarDay.toISOString() }, duePayload('NEXT_7_DAYS')), false);
  assert.equal(defaultConditions.DueDate({ dueDate: null }, duePayload('NO_DUE_DATE')), true);
  assert.equal(defaultConditions.DueDate({ dueDate: tomorrow.toISOString() }, duePayload('NO_DUE_DATE')), false);
});

test('native due-date ranges have readable labels and display ranges', () => {
  assert.equal(formatDateDisplay(duePayload('OVERDUE')), 'Overdue');
  assert.equal(formatDateDisplay(duePayload('NEXT_7_DAYS')), 'Next 7 days');
  assert.equal(formatDateDisplay(duePayload('NO_DUE_DATE')), 'No due date');

  const nextSevenDays = calculateDynamicDateRange('NEXT_7_DAYS');
  assert.ok(nextSevenDays);
  assert.ok(nextSevenDays.to > nextSevenDays.from);
  assert.match(
    renderDynamicDateRange(
      { isDynamic: true, dynamicRange: 'OVERDUE' },
      calculateDynamicDateRange,
    ),
    /^Through /,
  );
  assert.equal(calculateDynamicDateRange('NO_DUE_DATE'), null);
  assert.equal(
    renderDynamicDateRange(
      { isDynamic: true, dynamicRange: 'NO_DUE_DATE' },
      calculateDynamicDateRange,
    ),
    null,
  );
});
