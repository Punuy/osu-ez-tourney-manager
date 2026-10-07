// Exercises the osu! config writer against throwaway copies of real config shapes.
//   node test-osucfg.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'osucfg-'));

// point config.stablePath at the sandbox before osucfg.js reads it
const cfgMod = await import('./server/config.js');
cfgMod.config.stablePath = sandbox;

fs.writeFileSync(path.join(sandbox, 'osu!.exe'), '');
fs.writeFileSync(path.join(sandbox, 'tournament.cfg'), '');
fs.writeFileSync(path.join(sandbox, 'osu!.TestUser.cfg'),
  ['Username = TestUser',
   'Password = AQAAsecret==',
   'ShowInterface = 1',
   'ScoreMeter = Error',
   'DimLevel = 80',
   'keyScoreV2 = B'].join('\r\n') + '\r\n');

const { readOsuConfig, writeOsuConfig } = await import('./server/osucfg.js');
const userFile = path.join(sandbox, 'osu!.TestUser.cfg');
const tourneyFile = path.join(sandbox, 'tournament.cfg');
const read = () => fs.readFileSync(userFile, 'utf8').split(/\r?\n/).filter(Boolean);

// --- reading ---------------------------------------------------------------
let r = readOsuConfig();
assert.equal(r.tourneyEmpty, true, 'empty tournament.cfg detected');
assert.equal(r.values.ClientNameSize.isDefault, true, 'unset key reports as default');
assert.equal(r.values.ShowInterface.value, '1');
assert.equal(r.values.ShowInterface.isDefault, false);

// --- tournament.cfg: append, then replace in place --------------------------
writeOsuConfig({ ClientNameSize: '0', TeamSize: '1' });
let t = fs.readFileSync(tourneyFile, 'utf8').split(/\r?\n/).filter(Boolean);
assert.deepEqual(t, ['ClientNameSize = 0', 'TeamSize = 1'], 'both keys on their own lines');

writeOsuConfig({ ClientNameSize: '24' });
t = fs.readFileSync(tourneyFile, 'utf8').split(/\r?\n/).filter(Boolean);
assert.deepEqual(t, ['ClientNameSize = 24', 'TeamSize = 1'], 'replaced in place, TeamSize survived');

// repeated saves must not grow the file
for (let i = 0; i < 5; i++) writeOsuConfig({ ClientNameSize: '0' });
assert.equal(fs.readFileSync(tourneyFile, 'utf8').split(/\r?\n/).filter(Boolean).length, 2,
  'saving repeatedly does not append duplicates');

// --- osu!.<user>.cfg: only the named lines change ---------------------------
const before = read();
writeOsuConfig({ ShowInterface: '0', ScoreMeter: 'None' });
const after = read();
assert.equal(after.length, before.length, 'line count unchanged');
assert.ok(after.includes('Password = AQAAsecret=='), 'password line untouched');
assert.ok(after.includes('keyScoreV2 = B'), 'unrelated keys untouched');
assert.ok(after.includes('ShowInterface = 0') && after.includes('ScoreMeter = None'));
assert.equal(before.filter((l) => !after.includes(l)).length, 2, 'exactly two lines differ');
assert.ok(fs.existsSync(`${userFile}.bak`), 'previous config backed up');

// a key missing from the file gets appended, not silently dropped
writeOsuConfig({ FpsCounter: '0' });
assert.ok(read().includes('FpsCounter = 0'), 'missing key appended');

// --- validation: bad input must be refused, not written ---------------------
const rejects = [
  [{ ScoreMeter: 'Nope' }, 'value outside the allowed list'],
  [{ Height: '100' }, 'below the documented minimum'],
  [{ Aspect: '9' }, 'above the documented maximum'],
  [{ TeamSize: 'abc' }, 'not a number'],
];
for (const [patch, why] of rejects) {
  assert.throws(() => writeOsuConfig(patch), new RegExp('.'), `must reject: ${why}`);
}
const snapshot = read();
assert.throws(() => writeOsuConfig({ ShowInterface: '0', ScoreMeter: 'Nope' }));
assert.deepEqual(read(), snapshot, 'a rejected patch writes nothing at all');

// unknown keys are ignored rather than written through
writeOsuConfig({ TotallyMadeUpKey: 'x', ClientNameSize: '0' });
assert.ok(!fs.readFileSync(tourneyFile, 'utf8').includes('TotallyMadeUpKey'), 'allowlist holds');

fs.rmSync(sandbox, { recursive: true, force: true });
console.log('osucfg ok');
