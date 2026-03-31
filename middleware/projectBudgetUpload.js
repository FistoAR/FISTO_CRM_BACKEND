const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Create directories if they don't exist
const createDirectories = () => {
  const dirs = [
    path.join(__dirname, "../Images/ProjectBudget"),
    path.join(__dirname, "../Images/ProjectBudget/PO"),
    path.join(__dirname, "../Images/ProjectBudget/Invoice"),
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
};

createDirectories();

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = "";

    // Determine folder based on field name
    if (file.fieldname === "po") {
      uploadPath = path.join(__dirname, "../Images/ProjectBudget/PO");
    } else if (file.fieldname === "invoice") {
      uploadPath = path.join(__dirname, "../Images/ProjectBudget/Invoice");
    } else {
      uploadPath = path.join(__dirname, "../Images/ProjectBudget");
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: projectId_timestamp_originalname
    const projectId = req.body.projectId || "temp";
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    const uniqueName = `${projectId}_${timestamp}_${nameWithoutExt}${ext}`;
    
    cb(null, uniqueName);
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|doc|docx|jpg|jpeg|png|xlsx|xls/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error("Only PDF, DOC, DOCX, JPG, PNG, XLS, XLSX files are allowed"));
  }
};

// Create multer upload instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Export fields for multiple file uploads
const uploadProjectDocuments = upload.fields([
  { name: "po", maxCount: 10 },
  { name: "invoice", maxCount: 10 },
]);

module.exports = uploadProjectDocuments;
