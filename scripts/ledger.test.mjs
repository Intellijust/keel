import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatLedgerEntry, parseLedgerEntry } from './keel.mjs';

const STAMP = '2026-08-27 09:15';

describe('formatLedgerEntry — fields without breaking the line', () => {
  test('fields render as a bracketed prefix before the note', () => {
    const line = formatLedgerEntry({
      stamp: STAMP,
      phase: 'tdd',
      fields: { domain: 'engine', nodes: '8' },
      note: 'parser proven',
    });
    assert.equal(line, `- ${STAMP}  **TDD**  (domain: engine; nodes: 8)  parser proven`);
  });

  test('an entry with no fields renders exactly as it always has', () => {
    // Every consuming repo already holds ledgers written this way.
    assert.equal(
      formatLedgerEntry({ stamp: STAMP, phase: 'note', note: 'installed' }),
      `- ${STAMP}  **NOTE**  installed`,
    );
  });

  test('empty and undefined field values are dropped rather than rendered blank', () => {
    assert.equal(
      formatLedgerEntry({ stamp: STAMP, phase: 'note', fields: { domain: undefined, nodes: '' }, note: 'x' }),
      `- ${STAMP}  **NOTE**  x`,
    );
  });
});

describe('parseLedgerEntry — reading a ledger back', () => {
  test('a structured entry round-trips through format and parse', () => {
    const fields = { domain: 'engine', nodes: '11' };
    const parsed = parseLedgerEntry(
      formatLedgerEntry({ stamp: STAMP, phase: 'tdd', fields, note: 'mutate landed' }),
    );
    assert.deepEqual(parsed, { stamp: STAMP, phase: 'tdd', fields, note: 'mutate landed' });
  });

  test('an entry written before fields existed parses, with no fields', () => {
    const parsed = parseLedgerEntry(`- ${STAMP}  **VERIFY**  lint clean; 471 tests green`);
    assert.deepEqual(parsed, {
      stamp: STAMP,
      phase: 'verify',
      fields: {},
      note: 'lint clean; 471 tests green',
    });
  });

  test('a note that merely opens with a parenthesis is not mistaken for fields', () => {
    // `(deferred: …)` reads like a field pair; a note starting with prose does not.
    const parsed = parseLedgerEntry(`- ${STAMP}  **NOTE**  (see AUTH-12) the queue is empty`);
    assert.deepEqual(parsed.fields, {});
    assert.equal(parsed.note, '(see AUTH-12) the queue is empty');
  });

  test('a line that is not a ledger entry parses as nothing', () => {
    assert.equal(parseLedgerEntry('# Keel ledger'), null);
    assert.equal(parseLedgerEntry(''), null);
    assert.equal(parseLedgerEntry('- not an entry'), null);
  });

  test('a note containing a colon keeps it — the field split does not eat prose', () => {
    const parsed = parseLedgerEntry(
      `- ${STAMP}  **TDD**  (domain: engine)  found this: a real defect`,
    );
    assert.equal(parsed.fields.domain, 'engine');
    assert.equal(parsed.note, 'found this: a real defect');
  });
});
