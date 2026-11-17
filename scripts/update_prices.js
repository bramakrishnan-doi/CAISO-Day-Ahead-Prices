#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { fetchCaisoRangeChunked, dateStrAddDays } = require('../src/caiso');
const Database = require('../src/db');

const NODE_ID = 'MEADS_2_N101';
const DB_PATH = path.join(__dirname, '..', 'data', 'mead_daily.db');
const JSON_PATH = path.join(__dirname, '..', 'public', 'data', 'days.json');

function dateInPacific(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}${part('month')}${part('day')}`;
}

function normalizeInputDate(value, name) {
  if (!value) return null;
  const digits = value.replace(/-/g, '');
  if (!/^\d{8}$/.test(digits)) throw new Error(`${name} must be YYYY-MM-DD`);
  const y = Number(digits.slice(0, 4)), m = Number(digits.slice(4, 6)), d = Number(digits.slice(6, 8));
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`${name} is not a valid calendar date`);
  }
  return digits;
}

function dateKeyFromDisplay(value) {
  const parts = value.split('/');
  if (parts.length !== 3) throw new Error(`Unexpected CAISO operating date: ${value}`);
  return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`Database not found: ${DB_PATH}`);
  const today = dateInPacific();
  // Default range: seven operating dates ending today, plus tomorrow (8 total).
  const defaultStart = dateStrAddDays(today, -6);
  const defaultEnd = dateStrAddDays(today, 1);
  const start = normalizeInputDate(process.env.START_DATE, 'START_DATE') || defaultStart;
  const end = normalizeInputDate(process.env.END_DATE, 'END_DATE') || defaultEnd;
  if (start > end) throw new Error('START_DATE must be on or before END_DATE');

  console.log(`CAISO node ${NODE_ID}; refreshing ${start} through ${end} (Pacific operating dates)`);
  const database = new Database(DB_PATH);
  await database.whenReady();
  let chunkFailures = [];
  try {
    const results = await fetchCaisoRangeChunked(start, end, NODE_ID, progress => {
      console.log(JSON.stringify({ event: 'chunk', ...progress }));
      if (!progress.ok) chunkFailures.push(progress);
    });
    let saved = 0;
    for (const item of results) {
      if (!item || !item.ok || !item.data) continue;
      const data = item.data;
      database.upsertDay({
        key: dateKeyFromDisplay(data.date),
        date: data.date,
        hours: data.hours,
        source: 'caiso_api'
      }, true);
      saved++;
    }
    if (saved === 0) {
      throw new Error(`CAISO returned no usable daily rows for ${start} through ${end}; database and JSON were not published`);
    }
    const { spawnSync } = require('child_process');
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const exporter = path.join(__dirname, 'export_days_json.py');
    const exportResult = spawnSync(python, [exporter, DB_PATH, JSON_PATH], { stdio: 'inherit' });
    if (exportResult.error) throw exportResult.error;
    if (exportResult.status !== 0) throw new Error(`JSON export failed (exit ${exportResult.status})`);
    console.log(`Saved/merged ${saved} day rows; database now has ${database.getAllDays().length} days.`);
    if (chunkFailures.length) {
      console.warn(`${chunkFailures.length} CAISO chunk(s) failed; successful chunks were retained.`);
      process.exitCode = 2;
    }
  } finally {
    database.close();
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
