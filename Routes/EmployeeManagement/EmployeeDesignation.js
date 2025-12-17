const express = require('express');
const router = express.Router();
const db = require('../../dataBase/connection');

// GET all designations
router.get("/", (req, res) => {
  console.log("GET /api/designations called");
  
  const query = `
    SELECT id, designation, created_date, updated_date 
    FROM designations 
    ORDER BY created_date DESC
  `;

  db.pool.query(query, (err, results) => {  // ← CHANGED: db.pool.query
    if (err) {
      console.error("Fetch error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      designations: results,
    });
  });
});

// POST - Add new designation
router.post("/", (req, res) => {
  console.log("POST /api/designations called");
  const { designation } = req.body;

  // Validate
  if (!designation || !designation.trim()) {
    return res.status(400).json({
      status: false,
      message: "Designation name is required",
    });
  }

  const query = `INSERT INTO designations (designation) VALUES (?)`;

  db.pool.query(query, [designation.trim()], (err, result) => {  // ← CHANGED
    if (err) {
      console.error("Insert error:", err);
      
      // Check for duplicate entry
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({
          status: false,
          message: "This designation already exists",
        });
      }
      
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    console.log("Designation added successfully, ID:", result.insertId);
    res.json({
      status: true,
      message: "Designation added successfully",
      id: result.insertId,
      designation: designation.trim(),
    });
  });
});

// PUT - Update designation
router.put("/:id", (req, res) => {
  console.log(`PUT /api/designations/${req.params.id} called`);
  const { id } = req.params;
  const { designation } = req.body;

  // Validate
  if (!designation || !designation.trim()) {
    return res.status(400).json({
      status: false,
      message: "Designation name is required",
    });
  }

  const query = `UPDATE designations SET designation = ? WHERE id = ?`;

  db.pool.query(query, [designation.trim(), id], (err, result) => {  // ← CHANGED
    if (err) {
      console.error("Update error:", err);
      
      // Check for duplicate entry
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({
          status: false,
          message: "This designation already exists",
        });
      }
      
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Designation not found",
      });
    }

    res.json({
      status: true,
      message: "Designation updated successfully",
    });
  });
});

// DELETE designation
router.delete("/:id", (req, res) => {
  console.log(`DELETE /api/designations/${req.params.id} called`);
  const { id } = req.params;

  const query = `DELETE FROM designations WHERE id = ?`;

  db.pool.query(query, [id], (err, result) => {  // ← CHANGED
    if (err) {
      console.error("Delete error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Designation not found",
      });
    }

    res.json({
      status: true,
      message: "Designation deleted successfully",
    });
  });
});

module.exports = router;
