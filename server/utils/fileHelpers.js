'use strict';

const path = require('path');
const crypto = require('crypto');

// Parse video extensions from env, fallback to common formats
const VIDEO_EXTENSIONS = (
  process.env.VIDEO_EXTENSIONS || '.mp4,.mkv,.avi,.mov,.wmv,.flv,.webm,.m4v,.ts,.m2ts'
)
  .split(',')
  .map((e) => e.trim().toLowerCase());

// Parse subtitle extensions from env, fallback to common formats
const SUBTITLE_EXTENSIONS = (
  process.env.SUBTITLE_EXTENSIONS || '.srt,.vtt,.ass,.ssa'
)
  .split(',')
  .map((e) => e.trim().toLowerCase());

// Returns true if the filename has a video extension
function isVideoFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

// Returns true if the filename has a subtitle extension
function isSubtitleFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return SUBTITLE_EXTENSIONS.includes(ext);
}

/**
 * parseSubtitleFilename(baseName, subFilename)
 *
 * Extracts the language label and forced flag from a subtitle filename
 * that matches a known video base name.
 *
 * Handles patterns:
 *   Movie.srt               → { lang: 'und', label: 'Unknown', forced: false }
 *   Movie.en.srt            → { lang: 'en', label: 'English', forced: false }
 *   Movie.en-US.srt         → { lang: 'en-US', label: 'English (US)', forced: false }
 *   Movie.en.forced.srt     → { lang: 'en', label: 'English', forced: true }
 *   Movie.bn.srt            → { lang: 'bn', label: 'Bengali', forced: false }
 *
 * Returns null if subFilename doesn't start with baseName.
 */
const LANG_NAMES = {
  en: 'English', 'en-us': 'English (US)', 'en-gb': 'English (UK)',
  bn: 'Bengali', hi: 'Hindi', fr: 'French', de: 'German',
  es: 'Spanish', pt: 'Portuguese', 'pt-br': 'Portuguese (BR)',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', 'zh-cn': 'Chinese (Simplified)',
  'zh-tw': 'Chinese (Traditional)', ar: 'Arabic', ru: 'Russian',
  it: 'Italian', nl: 'Dutch', tr: 'Turkish', pl: 'Polish',
  sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
  cs: 'Czech', sk: 'Slovak', ro: 'Romanian', hu: 'Hungarian',
  uk: 'Ukrainian', he: 'Hebrew', fa: 'Persian', th: 'Thai',
  vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', und: 'Unknown',
};

function parseSubtitleFilename(videoBaseName, subFilename) {
  const subExt = path.extname(subFilename).toLowerCase();
  const subBase = path.basename(subFilename, subExt);

  // Must start with video base name (case-insensitive)
  if (!subBase.toLowerCase().startsWith(videoBaseName.toLowerCase())) return null;

  // Strip the video base name prefix
  const suffix = subBase.slice(videoBaseName.length); // e.g. '' | '.en' | '.en.forced' | '.en-US.forced'

  if (!suffix) {
    // Exact match (e.g. Movie.srt)
    return { lang: 'und', label: 'Unknown', forced: false };
  }

  if (!suffix.startsWith('.')) return null; // not a valid separator

  // Split remaining parts on '.'
  const parts = suffix.slice(1).split('.').filter(Boolean); // e.g. ['en'] | ['en', 'forced'] | ['en-US', 'forced']

  let lang = 'und';
  let forced = false;

  for (const part of parts) {
    if (part.toLowerCase() === 'forced') {
      forced = true;
    } else if (/^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/.test(part)) {
      lang = part;
    }
  }

  const label = LANG_NAMES[lang.toLowerCase()] || lang.toUpperCase();
  return { lang, label: forced ? `${label} (Forced)` : label, forced };
}

// Resolves and normalizes a path, blocking traversal attacks
function sanitizePath(inputPath) {
  const resolved = path.resolve(inputPath);
  return resolved;
}

// Generates a stable base64url ID from the absolute file path
function generateFileId(filePath) {
  const abs = path.resolve(filePath);
  return Buffer.from(abs).toString('base64url');
}

// Decodes a base64url file ID back to an absolute path
function decodeFileId(id) {
  return Buffer.from(id, 'base64url').toString();
}

// Converts bytes to a human-readable string (e.g. "2.4 GB")
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${value} ${units[i]}`;
}

module.exports = {
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  isVideoFile,
  isSubtitleFile,
  parseSubtitleFilename,
  sanitizePath,
  generateFileId,
  decodeFileId,
  formatFileSize,
};
