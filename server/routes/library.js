'use strict';

const express = require('express');
const router = express.Router();
const {
  getFolders,
  addFolder,
  removeFolder,
  updateFolder,
} = require('../controllers/libraryController');

const { optionalJWT, authenticateJWT } = require('../auth/middleware/authenticateJWT');
const { requireApprovedUser } = require('../auth/middleware/requireApprovedUser');
const { requireActiveAccess } = require('../auth/middleware/requireActiveAccess');
const { injectLibraryAccess } = require('../auth/middleware/requireLibraryAccess');

// GET /api/library — public browsing (optionalJWT for library filtering if logged in)
router.get('/', optionalJWT, injectLibraryAccess, getFolders);

// Mutating operations — require authenticated + approved + active
router.post('/', authenticateJWT, requireApprovedUser, requireActiveAccess, addFolder);
router.delete('/:id', authenticateJWT, requireApprovedUser, requireActiveAccess, removeFolder);
router.patch('/:id', authenticateJWT, requireApprovedUser, requireActiveAccess, updateFolder);

module.exports = router;
