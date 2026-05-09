'use strict';

const express = require('express');
const router = express.Router();
const {
  getAllMedia,
  getMediaById,
  searchMedia,
  getMediaSubtitles,
} = require('../controllers/mediaController');

router.get('/', getAllMedia);
router.get('/search', searchMedia);
router.get('/:id/subtitles', getMediaSubtitles);
router.get('/:id', getMediaById);

module.exports = router;
