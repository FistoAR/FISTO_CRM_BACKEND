const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const mongoose = require('mongoose');
const { WeeklyReports } = require('../../Models/DB_Collections');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'Images/WeeklyReports/';
    fs.mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch(cb);
  },
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('File type not supported for weekly reports.'));
  },
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

    const { employeeID, employeeName, designation, description } = req.body;

    const entry = new WeeklyReports({
      employeeID: employeeID || '',
      employeeName: employeeName || '',
      designation: designation || '',
      description: description || '',
      files: [{ filename: req.file.originalname, filepath: req.file.path.replace(/\\/g, '/'), size: req.file.size, mimetype: req.file.mimetype }],
    });

    const saved = await entry.save();
    res.status(201).json({ message: 'Weekly report uploaded.', data: saved });
  } catch (error) {
    console.error('Weekly report upload error:', error);
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ message: 'Server error.', error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const all = await WeeklyReports.find().sort({ createdAt: -1 }).lean();
    res.json({ data: all });
  } catch (error) {
    console.error('Fetch weekly reports error:', error);
    res.status(500).json({ message: 'Server error.', error: error.message });
  }
});

router.get('/by-designation', async (req, res) => {
  try {
    const pipeline = [
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$designation', items: { $push: '$$ROOT' } } },
    ];
    const grouped = await WeeklyReports.aggregate(pipeline);
    res.json({ data: grouped });
  } catch (error) {
    console.error('Group weekly reports error:', error);
    res.status(500).json({ message: 'Server error.', error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid report ID.' });
    }
    const report = await WeeklyReports.findById(id);
    if (!report) return res.status(404).json({ message: 'Report not found.' });
    
    // Delete associated files
    for (const file of report.files) {
      await fs.unlink(file.filepath).catch(() => {});
    }
    
    await WeeklyReports.findByIdAndDelete(id);
    res.json({ message: 'Report deleted.' });
  } catch (error) {
    console.error('Delete weekly report error:', error);
    res.status(500).json({ message: 'Server error.', error: error.message });
  }
});

module.exports = router;
