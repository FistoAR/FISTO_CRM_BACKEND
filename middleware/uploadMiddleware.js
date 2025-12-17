const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure directories exist
const ensureDirectoryExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath;
    
    // Determine folder based on fieldname
    switch (file.fieldname) {
      case 'profile':
        uploadPath = path.join(__dirname, '../Images/profiles');
        break;
      case 'resume':
        uploadPath = path.join(__dirname, '../Images/resumes');
        break;
      case 'aadhar':
      case 'panCard':
      case 'voterId':
      case 'drivingLicense':
        uploadPath = path.join(__dirname, '../Images/ids');
        break;
      case 'tenth':
      case 'twelfth':
      case 'degree':
      case 'probation':
        uploadPath = path.join(__dirname, '../Images/certificates');
        break;
      default:
        uploadPath = path.join(__dirname, '../Images/others');
    }
    
    ensureDirectoryExists(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate filename: datetime-randomnumber.ext
    const timestamp = Date.now();
    const randomNumber = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const filename = `${timestamp}-${randomNumber}${ext}`;
    
    console.log(`Saving file as: ${filename}`);
    cb(null, filename);
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  // Accept images and PDFs
  if (
    file.mimetype.startsWith('image/') ||
    file.mimetype === 'application/pdf' ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.mimetype === 'application/msword'
  ) {
    cb(null, true);
  } else {
    cb(
      new Error('Invalid file type. Only images, PDFs, and Word documents are allowed.'),
      false
    );
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

// Multiple file fields
const uploadFields = upload.fields([
  { name: 'profile', maxCount: 1 },
  { name: 'resume', maxCount: 1 },
  { name: 'aadhar', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'voterId', maxCount: 1 },
  { name: 'drivingLicense', maxCount: 1 },
  { name: 'tenth', maxCount: 1 },
  { name: 'twelfth', maxCount: 1 },
  { name: 'degree', maxCount: 1 },
  { name: 'probation', maxCount: 1 },
  { name: 'otherDocs', maxCount: 10 },
]);

module.exports = uploadFields;
