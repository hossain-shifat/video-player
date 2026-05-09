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
  sanitizePath,
  generateFileId,
  decodeFileId,
  formatFileSize,
};
