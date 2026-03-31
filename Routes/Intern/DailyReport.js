const express = require("express");
const router = express.Router();
const { pool } = require("../../dataBase/connection");

// Convert pool to promise-based for async/await
const promisePool = pool.promise();

// GET endpoint - Fetch today's hours from attendance table
router.get("/get-today-hours", async (req, res) => {
  const { employee_id } = req.query;

  console.log("⏰ Fetching today's hours for:", employee_id);

  if (!employee_id) {
    return res.status(400).json({
      success: false,
      error: "Employee ID is required",
    });
  }

  try {
    // Get today's date
    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];

    const query = `
      SELECT total_hours, login_date 
      FROM attendance 
      WHERE employee_id = ? AND login_date = ?
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const [results] = await promisePool.query(query, [employee_id, todayDate]);

    if (results.length > 0) {
      const loginDate = new Date(results[0].login_date);
      const formattedDate = loginDate.toISOString().split('T')[0];
      
      console.log("✅ Hours found:", results[0].total_hours, "for date:", formattedDate);
      
      res.json({
        success: true,
        hours: results[0].total_hours,
        date: formattedDate,
      });
    } else {
      console.log("⚠️ No attendance record for today");
      res.json({
        success: false,
        hours: null,
        date: todayDate,
        message: "No attendance record found for today",
      });
    }
  } catch (error) {
    console.error("❌ Error fetching hours:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch hours",
      details: error.message,
    });
  }
});

// POST endpoint - Submit daily report
router.post("/submit", async (req, res) => {
  console.log("📝 Daily Report Submission:", {
    employee_id: req.body.employee_id,
    employee_name: req.body.employee_name,
    report_date: req.body.report_date,
    project_name: req.body.project_name,
    hours: req.body.hours,
    section: req.body.section,
    work_done_length: req.body.work_done?.length,
  });

  const {
    employee_id,
    employee_name,
    report_date,
    project_name,
    hours,
    work_done,
    section,
  } = req.body;

  // Validation
  if (!employee_id || !employee_name || !report_date || !project_name || !work_done) {
    console.error("❌ Validation failed - missing fields");
    return res.status(400).json({
      success: false,
      error: "Required fields: Date, Project Name, and Work Done",
    });
  }

  const validSections = ["Full Day", "Morning", "Afternoon"];
  const finalSection = section && validSections.includes(section) ? section : "Full Day";

  let finalHours = 0;
  if (hours !== null && hours !== undefined && hours !== "") {
    if (isNaN(hours) || parseFloat(hours) < 0) {
      console.error("❌ Invalid hours:", hours);
      return res.status(400).json({
        success: false,
        error: "Hours must be a valid non-negative number",
      });
    }
    finalHours = parseFloat(hours);
  }

  try {
    // Check for duplicate
    console.log("🔍 Checking for duplicate report...");
    const checkQuery = `
      SELECT id FROM intern_dailyreport 
      WHERE employee_id = ? AND report_date = ?
    `;
    
    const [existingReport] = await promisePool.query(checkQuery, [employee_id, report_date]);

    if (existingReport.length > 0) {
      console.log("⚠️ Duplicate report found");
      return res.status(200).json({
        success: false,
        error: "Daily report already submitted for this date",
      });
    }

    // Insert report
    console.log("💾 Inserting daily report...");
    const insertQuery = `
      INSERT INTO intern_dailyreport 
      (employee_id, employee_name, report_date, project_name, hours, work_done, section) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await promisePool.query(insertQuery, [
      employee_id,
      employee_name,
      report_date,
      project_name.trim(),
      finalHours,
      work_done.trim(),
      finalSection,
    ]);

    console.log("✅ Report inserted successfully! ID:", result.insertId);

    res.json({
      success: true,
      message: "Daily report submitted successfully!",
      report_id: result.insertId,
    });
  } catch (error) {
    console.error("❌ Database error:", error);
    console.error("Error code:", error.code);
    
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        success: false,
        error: "Database table 'intern_dailyreport' does not exist. Please create it first.",
        code: error.code
      });
    }

    if (error.code === 'ER_TOO_MANY_USER_CONNECTIONS') {
      return res.status(503).json({
        success: false,
        error: "Database is busy. Please try again in a moment.",
        code: error.code
      });
    }
    
    res.status(500).json({
      success: false,
      error: "Failed to submit daily report",
      details: error.message,
      code: error.code
    });
  }
});


router.get("/reports/:employee_id", async (req, res) => {
  const { employee_id } = req.params;
  const { start_date, end_date, limit = 50 } = req.query;

  try {
    let query = `
      SELECT
        COALESCE(idr.id, '-') AS report_id,
        att.employee_id,
        att.login_date AS report_date,
        att.total_hours AS hours,
        att.morning_in,
        att.morning_out,
        att.afternoon_in,
        att.afternoon_out,

        COALESCE(idr.employee_name, '-') AS employee_name,
        COALESCE(idr.project_name, '-') AS project_name,
        COALESCE(idr.work_done, '-') AS work_done,
        COALESCE(idr.section, '-') AS section,
        COALESCE(idr.created_at, '-') AS created_at,
        COALESCE(idr.updated_at, '-') AS updated_at
      FROM attendance att
      LEFT JOIN intern_dailyreport idr
        ON idr.employee_id = att.employee_id
        AND idr.report_date = att.login_date
      WHERE att.employee_id = ?
    `;

    const params = [employee_id];

    if (start_date && end_date) {
      query += ` AND att.login_date BETWEEN ? AND ?`;
      params.push(start_date, end_date);
    }

    query += `
      ORDER BY att.login_date DESC, idr.created_at DESC
      LIMIT ?
    `;
    params.push(parseInt(limit));

    const [reports] = await promisePool.query(query, params);

    res.json({
      success: true,
      count: reports.length,
      reports,
    });
  } catch (error) {
    console.error("Error fetching daily reports:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch daily reports",
      details: error.message,
    });
  }
});


// PUT endpoint - Update daily report
router.put("/update/:report_id", async (req, res) => {
  const { report_id } = req.params;
  const { project_name, hours, work_done, section } = req.body;

  if (!project_name || !work_done) {
    return res.status(400).json({
      success: false,
      error: "Project Name and Work Done are required",
    });
  }

  try {
    const checkQuery = `SELECT id FROM intern_dailyreport WHERE id = ?`;
    const [existingReport] = await promisePool.query(checkQuery, [report_id]);

    if (existingReport.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Daily report not found",
      });
    }

    let finalHours = 0;
    if (hours !== null && hours !== undefined && hours !== "") {
      if (isNaN(hours) || parseFloat(hours) < 0) {
        return res.status(400).json({
          success: false,
          error: "Hours must be a valid non-negative number",
        });
      }
      finalHours = parseFloat(hours);
    }

    const validSections = ["Full Day", "Morning", "Afternoon"];
    const finalSection = section && validSections.includes(section) ? section : "Full Day";

    const updateQuery = `
      UPDATE intern_dailyreport 
      SET project_name = ?, hours = ?, work_done = ?, section = ?
      WHERE id = ?
    `;

    await promisePool.query(updateQuery, [
      project_name.trim(),
      finalHours,
      work_done.trim(),
      finalSection,
      report_id,
    ]);

    res.json({
      success: true,
      message: "Daily report updated successfully",
    });
  } catch (error) {
    console.error("Error updating daily report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update daily report",
      details: error.message,
    });
  }
});

// DELETE endpoint - Delete daily report
router.delete("/delete/:report_id", async (req, res) => {
  const { report_id } = req.params;

  try {
    const deleteQuery = `DELETE FROM intern_dailyreport WHERE id = ?`;
    const [result] = await promisePool.query(deleteQuery, [report_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: "Daily report not found",
      });
    }

    res.json({
      success: true,
      message: "Daily report deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting daily report:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete daily report",
      details: error.message,
    });
  }
});

module.exports = router;
