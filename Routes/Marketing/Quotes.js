const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure directories exist
const ensureDirectoryExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Storage configuration for quotes images
const quotesStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../../Images/quotes");
    ensureDirectoryExists(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomNumber = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const filename = `quote-${timestamp}-${randomNumber}${ext}`;
    cb(null, filename);
  },
});

// Storage configuration for employee images
const employeeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../../Images/employees");
    ensureDirectoryExists(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomNumber = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const filename = `employee-${timestamp}-${randomNumber}${ext}`;
    cb(null, filename);
  },
});

// Storage configuration for occasion images
const occasionStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../../Images/occasions");
    ensureDirectoryExists(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomNumber = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const filename = `occasion-${timestamp}-${randomNumber}${ext}`;
    cb(null, filename);
  },
});

// File filter for images only
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed"), false);
  }
};

// Configure multer instances
const uploadQuote = multer({
  storage: quotesStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadEmployee = multer({
  storage: employeeStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadOccasion = multer({
  storage: occasionStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ==================== QUOTES ROUTES ====================

// GET - Fetch all quotes
router.get("/", (req, res) => {
  const query = `
    SELECT 
      id, date, quote, occasion, image_url, 
      created_at, updated_at
    FROM quotes
    ORDER BY date DESC, id DESC
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch quotes error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      quotes: results,
    });
  });
});

// GET - Fetch single quote by ID
router.get("/:id", (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT 
      id, date, quote, occasion, image_url, 
      created_at, updated_at
    FROM quotes
    WHERE id = ?
  `;

  db.pool.query(query, [id], (err, results) => {
    if (err) {
      console.error("Fetch single quote error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Quote not found",
      });
    }

    res.json({
      status: true,
      quote: results[0],
    });
  });
});

// POST - Create new quote
// Image is optional — if not provided, imageUrl stays null
router.post("/", uploadQuote.single("image"), (req, res) => {
  const { date, quote, occasion } = req.body;

  if (!date || !quote) {
    return res.status(400).json({
      status: false,
      message: "Date and quote are required",
    });
  }

  let imageUrl = null;
  if (req.file) {
    imageUrl = `/Images/quotes/${req.file.filename}`;
  } else if (req.body.imageUrl) {
    imageUrl = req.body.imageUrl;
  }
  // No image is perfectly fine — imageUrl remains null

  const query = `
    INSERT INTO quotes (date, quote, occasion, image_url)
    VALUES (?, ?, ?, ?)
  `;

  db.pool.query(
    query,
    [date, quote, occasion || null, imageUrl],
    (err, result) => {
      if (err) {
        console.error("Insert quote error:", err);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: err.message,
        });
      }

      res.json({
        status: true,
        message: "Quote added successfully",
        id: result.insertId,
      });
    }
  );
});

// PUT - Update existing quote
// If a new image is provided, replace the old one.
// If no new image is provided, keep the existing image unchanged.
router.put("/:id", uploadQuote.single("image"), (req, res) => {
  const { id } = req.params;
  const { date, quote, occasion } = req.body;

  if (!date || !quote) {
    return res.status(400).json({
      status: false,
      message: "Date and quote are required",
    });
  }

  const selectQuery = `SELECT image_url FROM quotes WHERE id = ?`;

  db.pool.query(selectQuery, [id], (err, results) => {
    if (err) {
      console.error("Select quote error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Quote not found",
      });
    }

    const existingQuote = results[0];
    // Default: keep the existing image untouched
    let imageUrl = existingQuote.image_url;
    let shouldDeleteOldImage = false;

    if (req.file) {
      // New file uploaded — replace image
      imageUrl = `/Images/quotes/${req.file.filename}`;
      if (
        existingQuote.image_url &&
        existingQuote.image_url.startsWith("/Images/quotes/")
      ) {
        shouldDeleteOldImage = true;
      }
    } else if (req.body.imageUrl) {
      // A URL was passed (selected from gallery) — replace image
      imageUrl = req.body.imageUrl;
      if (
        existingQuote.image_url &&
        existingQuote.image_url.startsWith("/Images/quotes/")
      ) {
        shouldDeleteOldImage = true;
      }
    }
    // No file and no imageUrl body field → imageUrl stays as existingQuote.image_url (no change)

    const updateQuery = `
      UPDATE quotes 
      SET date = ?, quote = ?, occasion = ?, image_url = ?
      WHERE id = ?
    `;

    db.pool.query(
      updateQuery,
      [date, quote, occasion || null, imageUrl, id],
      (updateErr) => {
        if (updateErr) {
          console.error("Update quote error:", updateErr);
          return res.status(500).json({
            status: false,
            message: "Database error",
            error: updateErr.message,
          });
        }

        if (shouldDeleteOldImage) {
          const oldFilePath = path.join(
            __dirname,
            "../..",
            existingQuote.image_url
          );
          fs.unlink(oldFilePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error("Error deleting old image:", unlinkErr);
            }
          });
        }

        res.json({
          status: true,
          message: "Quote updated successfully",
        });
      }
    );
  });
});

// DELETE - Delete quote
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  const selectQuery = `SELECT image_url FROM quotes WHERE id = ?`;

  db.pool.query(selectQuery, [id], (err, results) => {
    if (err) {
      console.error("Select quote error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Quote not found",
      });
    }

    const quote = results[0];

    const deleteQuery = `DELETE FROM quotes WHERE id = ?`;

    db.pool.query(deleteQuery, [id], (deleteErr) => {
      if (deleteErr) {
        console.error("Delete quote error:", deleteErr);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: deleteErr.message,
        });
      }

      if (quote.image_url && quote.image_url.startsWith("/Images/quotes/")) {
        const filePath = path.join(__dirname, "../..", quote.image_url);
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Error deleting image file:", unlinkErr);
          }
        });
      }

      res.json({
        status: true,
        message: "Quote deleted successfully",
      });
    });
  });
});

// ==================== EMPLOYEE IMAGES ROUTES ====================

// GET - Fetch all employee images
router.get("/images/employees", (req, res) => {
  const query = `
    SELECT id, employee_name as name, image_url as imageUrl
    FROM employee_images
    ORDER BY employee_name
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch employee images error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      images: results,
    });
  });
});

// POST - Add new employee image
router.post("/images/employees", uploadEmployee.single("image"), (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      status: false,
      message: "Employee name is required",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      status: false,
      message: "Image is required",
    });
  }

  const imageUrl = `/Images/employees/${req.file.filename}`;

  const query = `
    INSERT INTO employee_images (employee_name, image_url)
    VALUES (?, ?)
  `;

  db.pool.query(query, [name.trim(), imageUrl], (err, result) => {
    if (err) {
      console.error("Insert employee image error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      message: "Employee image added successfully",
      id: result.insertId,
      imageUrl: imageUrl,
    });
  });
});

// DELETE - Delete employee image
router.delete("/images/employees/:id", (req, res) => {
  const { id } = req.params;

  const selectQuery = `SELECT image_url FROM employee_images WHERE id = ?`;

  db.pool.query(selectQuery, [id], (err, results) => {
    if (err) {
      console.error("Select employee image error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Employee image not found",
      });
    }

    const image = results[0];

    const deleteQuery = `DELETE FROM employee_images WHERE id = ?`;

    db.pool.query(deleteQuery, [id], (deleteErr) => {
      if (deleteErr) {
        console.error("Delete employee image error:", deleteErr);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: deleteErr.message,
        });
      }

      if (image.image_url && image.image_url.startsWith("/Images/employees/")) {
        const filePath = path.join(__dirname, "../..", image.image_url);
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Error deleting image file:", unlinkErr);
          }
        });
      }

      res.json({
        status: true,
        message: "Employee image deleted successfully",
      });
    });
  });
});

// ==================== OCCASION IMAGES ROUTES ====================

// GET - Fetch all occasion images
router.get("/images/occasions", (req, res) => {
  const query = `
    SELECT id, occasion_name as name, image_url as imageUrl
    FROM occasion_images
    ORDER BY occasion_name
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch occasion images error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      images: results,
    });
  });
});

// POST - Add new occasion image
router.post("/images/occasions", uploadOccasion.single("image"), (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      status: false,
      message: "Occasion name is required",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      status: false,
      message: "Image is required",
    });
  }

  const imageUrl = `/Images/occasions/${req.file.filename}`;

  const query = `
    INSERT INTO occasion_images (occasion_name, image_url)
    VALUES (?, ?)
  `;

  db.pool.query(query, [name.trim(), imageUrl], (err, result) => {
    if (err) {
      console.error("Insert occasion image error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      message: "Occasion image added successfully",
      id: result.insertId,
      imageUrl: imageUrl,
    });
  });
});

// DELETE - Delete occasion image
router.delete("/images/occasions/:id", (req, res) => {
  const { id } = req.params;

  const selectQuery = `SELECT image_url FROM occasion_images WHERE id = ?`;

  db.pool.query(selectQuery, [id], (err, results) => {
    if (err) {
      console.error("Select occasion image error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Occasion image not found",
      });
    }

    const image = results[0];

    const deleteQuery = `DELETE FROM occasion_images WHERE id = ?`;

    db.pool.query(deleteQuery, [id], (deleteErr) => {
      if (deleteErr) {
        console.error("Delete occasion image error:", deleteErr);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: deleteErr.message,
        });
      }

      if (image.image_url && image.image_url.startsWith("/Images/occasions/")) {
        const filePath = path.join(__dirname, "../..", image.image_url);
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Error deleting image file:", unlinkErr);
          }
        });
      }

      res.json({
        status: true,
        message: "Occasion image deleted successfully",
      });
    });
  });
});

module.exports = router;