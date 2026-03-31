console.log("🚀 LOADING Workdone route...");

const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ========== CREATE WORK REPORT ==========
router.post("/reports", async (req, res) => {
  console.log("✅ WORK REPORT SUBMIT HIT!");
  try {
    const userData = JSON.parse(req.headers["x-user-data"] || "{}");
    const employee_id = userData.userName || "FST001";
    const employee_name = userData.employeeName || employee_id;
    const { project_name, description } = req.body;

    if (!project_name?.trim() || !description?.trim()) {
      return res.status(400).json({
        success: false,
        error: "Project name and description are required",
      });
    }

    const result = await queryWithRetry(
      `INSERT INTO workdone_reports 
       (employee_id, employee_name, project_name, description)
       VALUES (?, ?, ?, ?)`,
      [employee_id, employee_name, project_name.trim(), description.trim()]
    );

    console.log(`✅ Work report created with ID: ${result.insertId}`);

    res.json({
      success: true,
      message: "Work report submitted successfully",
      reportId: result.insertId,
      employee_id: employee_id,
    });
  } catch (err) {
    console.error("❌ Work report error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to submit work report",
    });
  }
});

// ========== GET WORK REPORTS ==========
router.get("/reports", async (req, res) => {
  console.log("✅ GET WORK REPORTS HIT!");
  try {
    const { employee_id } = req.query;

    let query = `SELECT * FROM workdone_reports ORDER BY created_at DESC`;
    let params = [];

    // If employee_id is provided, filter by that employee
    if (employee_id) {
      query = `SELECT * FROM workdone_reports 
               WHERE employee_id = ? 
               ORDER BY created_at DESC`;
      params = [employee_id];
    }

    const results = await queryWithRetry(query, params);

    res.json({
      success: true,
      reports: results,
      count: results.length,
    });
  } catch (err) {
    console.error("❌ Get work reports error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch work reports",
    });
  }
});

// ========== GET SINGLE WORK REPORT ==========
router.get("/reports/:id", async (req, res) => {
  console.log("✅ GET SINGLE WORK REPORT HIT!");
  try {
    const { id } = req.params;

    const results = await queryWithRetry(
      `SELECT * FROM workdone_reports WHERE id = ?`,
      [id]
    );

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work report not found",
      });
    }

    res.json({
      success: true,
      report: results[0],
    });
  } catch (err) {
    console.error("❌ Get single work report error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch work report",
    });
  }
});

// ========== TEST ROUTE ==========
router.get("/test", (req, res) => {
  console.log("✅ WORKDONE TEST ROUTE WORKS!");
  res.json({ success: true, message: "Workdone route LOADED!" });
});

module.exports = router;
console.log("✅ Workdone EXPORTED!");
