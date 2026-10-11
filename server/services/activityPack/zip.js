/**
 * Reading and writing the activity package ZIP. The layout is described in format.js.
 *
 * READING AN UPLOADED PACKAGE IS READING UNTRUSTED INPUT (rule 2 of the package rules):
 *
 *   - Entry names are never used as paths. Nothing is ever extracted to disk from here: the
 *     reader hands back parsed JSON, strings and Buffers, and import.js writes originals under
 *     names it generates itself. A package holding any entry with an absolute path, a drive
 *     letter, a backslash or a ".." segment is refused outright.
 *   - Only entries the manifest and each activity.json name are read, and each name is checked
 *     against a fixed pattern BEFORE the entry is looked up.
 *   - Sizes are enforced while inflating, not from the sizes the ZIP declares (those are
 *     written by whoever made the file): a per-entry cap, and one running total for the whole
 *     package. Reading stops at the cap, so a small file that inflates to gigabytes costs at
 *     most the cap.
 *   - The entry count is read from the ZIP's end record before the archive is parsed.
 *
 * JSZip keeps the whole archive in memory, which is why LIMITS.packBytes bounds the upload.
 */

import JSZip from 'jszip';
import { assertInstallable } from './capabilities.js';
import { LIMITS, ORIGINAL_EXTENSIONS, PackError, extensionOf, sha256 } from './format.js';

const notAPack = () => new PackError(400, 'NOT_A_PACK', 'This file is not a MakeTheCase activity package.');
const invalid = (message) => new PackError(400, 'INVALID_PACK', `This is not a valid activity package: ${message}`);
const tooLarge = (what) => new PackError(413, 'PACK_TOO_LARGE', `This package is too large to install: ${what}.`);

const ACTIVITY_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TEXT_PATH_RE = /^documents\/[a-z0-9][a-z0-9._-]{0,80}\.md$/;
const ORIGINAL_PATH_RE = /^originals\/[a-z0-9][a-z0-9._-]{0,80}$/;

const jsonBuffer = (value) => Buffer.from(JSON.stringify(value, null, 2), 'utf8');

/**
 * A package in memory -> the ZIP file as a Buffer.
 * `pack.originals` is a Map of `${activity.key}/${doc.key}` -> Buffer for documents that carry
 * an original.
 */
export async function zipPack(pack) {
  const zip = new JSZip();
  zip.file('manifest.json', jsonBuffer(pack.manifest));
  zip.file('personas.json', jsonBuffer(pack.personas));
  zip.file('rubrics.json', jsonBuffer({ rubrics: pack.rubrics, criteria: pack.criteria }));
  for (const activity of pack.activities) {
    const dir = `activities/${activity.key}/`;
    zip.file(`${dir}activity.json`, jsonBuffer(activity));
    for (const doc of activity.documents) {
      const ref = `${activity.key}/${doc.key}`;
      if (doc.text) zip.file(dir + doc.text, Buffer.from(pack.texts.get(ref), 'utf8'));
      if (doc.original) zip.file(dir + doc.original.path, pack.originals.get(ref));
    }
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (buffer.length > LIMITS.packBytes) {
    throw new PackError(413, 'PACK_TOO_LARGE',
      `This package would be ${Math.ceil(buffer.length / (1024 * 1024))} MB, over the ${LIMITS.packBytes / (1024 * 1024)} MB limit. Download fewer cases at a time, or leave out the original files.`);
  }
  return buffer;
}

/**
 * The number of entries a ZIP declares in its end-of-central-directory record, or null when
 * there is no such record (not a ZIP). 0xFFFF means "see the ZIP64 record", which no package
 * within the entry limit needs.
 */
function declaredEntryCount(buffer) {
  const SIGNATURE = 0x06054b50;
  const earliest = Math.max(0, buffer.length - (22 + 0xffff));
  for (let i = buffer.length - 22; i >= earliest; i--) {
    if (buffer.readUInt32LE(i) === SIGNATURE) return buffer.readUInt16LE(i + 10);
  }
  return null;
}

/** Inflate one entry, stopping at `maxBytes` or when the package total is spent. */
function readEntry(file, maxBytes, budget, what) {
  const declared = file._data?.uncompressedSize;
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(`${what} is over its size limit`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const helper = file.internalStream('nodebuffer');
    helper
      .on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes || budget.used + size > budget.limit) {
          settled = true;
          helper.pause();
          reject(tooLarge(size > maxBytes ? `${what} is over its size limit` : 'its contents are over the total size limit'));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', () => {
        if (settled) return;
        settled = true;
        reject(invalid(`${what} could not be read (the file is damaged)`));
      })
      .on('end', () => {
        if (settled) return;
        settled = true;
        budget.used += size;
        resolve(Buffer.concat(chunks));
      })
      .resume();
  });
}

/**
 * An uploaded ZIP -> a package in memory:
 *   { manifest, activities, personas, rubrics, criteria, texts, readOriginal(activityKey, doc) }
 *
 * Refuses a package this server cannot install (capabilities.js) as soon as the manifest is
 * read, before any other entry. The caller then runs format.js#assertValidPack on the result.
 * Originals are read only when readOriginal() is called (at install, not for the preview),
 * and are checked against the size and checksum the package states.
 */
export async function openPack(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw notAPack();
  if (buffer.length > LIMITS.packBytes) throw tooLarge(`the file is over ${LIMITS.packBytes / (1024 * 1024)} MB`);

  const declaredEntries = declaredEntryCount(buffer);
  if (declaredEntries === null) throw notAPack();
  if (declaredEntries > LIMITS.entries) throw tooLarge(`it holds more than ${LIMITS.entries} files`);

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer, { createFolders: false });
  } catch {
    throw notAPack();
  }

  const names = Object.keys(zip.files);
  if (names.length > LIMITS.entries) throw tooLarge(`it holds more than ${LIMITS.entries} files`);
  for (const name of names) {
    const entry = zip.files[name];
    // JSZip resolves "." and ".." itself and keeps what the archive really said in
    // unsafeOriginalName (set on every file), so a difference means the name was not plain.
    const renamed = entry.unsafeOriginalName !== undefined && entry.unsafeOriginalName !== name;
    if (renamed || name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
      throw invalid('it contains a file with an unsafe name');
    }
  }

  const budget = { used: 0, limit: LIMITS.totalBytes };
  const read = async (name, maxBytes, what) => {
    const entry = zip.files[name];
    if (!entry || entry.dir) throw invalid(`${what} is missing`);
    return readEntry(entry, maxBytes, budget, what);
  };
  const readJson = async (name, what) => {
    const raw = await read(name, LIMITS.jsonBytes, what);
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      throw invalid(`${what} is not valid JSON`);
    }
  };

  const manifest = await readJson('manifest.json', 'manifest.json');
  assertInstallable(manifest);

  const personas = await readJson('personas.json', 'personas.json');
  const rubricsFile = await readJson('rubrics.json', 'rubrics.json');
  if (!rubricsFile || typeof rubricsFile !== 'object' || Array.isArray(rubricsFile)) throw invalid('rubrics.json is not an object');

  if (!Array.isArray(manifest.activities)) throw invalid('the manifest has no activity list');
  if (manifest.activities.length > LIMITS.activities) throw tooLarge(`it holds more than ${LIMITS.activities} activities`);

  const activities = [];
  const texts = new Map();
  for (const listed of manifest.activities) {
    const key = listed?.key;
    if (typeof key !== 'string' || !ACTIVITY_KEY_RE.test(key)) throw invalid('the manifest lists an activity with an invalid key');
    const dir = `activities/${key}/`;
    const activity = await readJson(`${dir}activity.json`, `the activity file for "${key}"`);
    if (!activity || typeof activity !== 'object' || Array.isArray(activity) || activity.key !== key) {
      throw invalid(`the activity file for "${key}" does not match the manifest`);
    }
    if (!Array.isArray(activity.documents)) throw invalid(`activity "${key}" has no document list`);
    if (activity.documents.length > LIMITS.documents) throw tooLarge(`activity "${key}" holds more than ${LIMITS.documents} documents`);
    for (const doc of activity.documents) {
      if (!doc || typeof doc !== 'object' || typeof doc.key !== 'string') throw invalid(`activity "${key}" has a document without a key`);
      if (doc.text === null || doc.text === undefined) continue;
      if (typeof doc.text !== 'string' || !TEXT_PATH_RE.test(doc.text)) throw invalid(`activity "${key}" has a document with an invalid text path`);
      const body = await read(dir + doc.text, LIMITS.textBytes, `the text of a document in "${key}"`);
      texts.set(`${key}/${doc.key}`, body.toString('utf8'));
    }
    activities.push(activity);
  }

  const readOriginal = async (activityKey, doc) => {
    const o = doc?.original;
    if (!o || typeof o.path !== 'string' || !ORIGINAL_PATH_RE.test(o.path) || !ACTIVITY_KEY_RE.test(activityKey)) {
      throw invalid('a document has an invalid original path');
    }
    if (!ORIGINAL_EXTENSIONS.includes(extensionOf(o.path))) throw invalid('a document has an original file of a type that is not allowed');
    const data = await read(`activities/${activityKey}/${o.path}`, LIMITS.originalBytes, `the original file "${String(o.filename).slice(0, 80)}"`);
    if (data.length !== o.bytes || sha256(data) !== o.sha256) {
      throw invalid(`the original file "${String(o.filename).slice(0, 80)}" does not match its checksum (the file is damaged or was edited)`);
    }
    return data;
  };

  return {
    manifest,
    activities,
    personas,
    rubrics: rubricsFile.rubrics,
    criteria: rubricsFile.criteria,
    texts,
    readOriginal,
  };
}
