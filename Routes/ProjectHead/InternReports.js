const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ✅ GET - All intern reports with attendance data (CORRECTED)
router.get("/all-reports", async (req, res) => {
  try {
    const { limit = 1000, employee_id, start_date, end_date } = req.query;

    let query = `
      SELECT 
        COALESCE(idr.id, '-') AS id,
        att.employee_id,
        COALESCE(att.employee_name, '-') AS employee_name,
        att.login_date AS report_date,
        COALESCE(idr.project_name, '-') AS project_name,
        att.total_hours AS hours,
        COALESCE(idr.work_done, '-') AS work_done,
        COALESCE(idr.section, '-') AS section,
        COALESCE(idr.created_at, '-') AS created_at,
        COALESCE(idr.updated_at, '-') AS updated_at,
        att.morning_in,
        att.morning_out,
        att.afternoon_in,
        att.afternoon_out
      FROM attendance att
      LEFT JOIN intern_dailyreport idr
        ON idr.employee_id = att.employee_id
        AND idr.report_date = att.login_date
      WHERE 1=1
    `;

    const params = [];

    // ✅ CRITICAL FIX: Filter on att.employee_id (LEFT table), not idr.employee_id
    if (employee_id && employee_id !== "all") {
      query += ` AND att.employee_id = ?`;
      params.push(employee_id);
    }

    // ✅ CRITICAL FIX: Filter on att.login_date (LEFT table), not idr.report_date
    if (start_date) {
      query += ` AND att.login_date >= ?`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND att.login_date <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY att.login_date DESC, idr.created_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    console.log(`Query here: ${query}`);

    const reports = await queryWithRetry(query, params);

    res.json({
      success: true,
      count: reports.length,
      reports: reports,
    });
  } catch (error) {
    console.error("Get all intern reports error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching intern reports",
      error: error.message,
    });
  }
});

// ✅ GET - Intern reports by specific employee (with attendance)
router.get("/reports/:employee_id", async (req, res) => {
  try {
    const { employee_id } = req.params;
    const { limit = 100 } = req.query;

    const query = `
      SELECT 
        idr.id,
        idr.employee_id,
        idr.employee_name,
        idr.report_date,
        idr.project_name,
        idr.hours,
        idr.work_done,
        idr.section,
        idr.created_at,
        idr.updated_at,
        att.morning_in as time_in,
        COALESCE(att.afternoon_out, att.morning_out) as time_out
      FROM intern_dailyreport idr
      LEFT JOIN attendance att 
        ON idr.employee_id = att.employee_id 
        AND idr.report_date = att.login_date
      WHERE idr.employee_id = ?
      ORDER BY idr.report_date DESC, idr.created_at DESC
      LIMIT ?
    `;

    const reports = await queryWithRetry(query, [employee_id, parseInt(limit)]);

    res.json({
      success: true,
      count: reports.length,
      reports: reports,
    });
  } catch (error) {
    console.error("Get intern reports by employee error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching intern reports",
      error: error.message,
    });
  }
});

// ✅ GET - Intern reports by date range (with attendance) - CORRECTED
router.get("/reports-by-date", async (req, res) => {
  try {
    const { start_date, end_date, employee_id } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: "start_date and end_date are required",
      });
    }

    let query = `
      SELECT 
        COALESCE(idr.id, '-') AS id,
        att.employee_id,
        COALESCE(att.employee_name, '-') AS employee_name,
        att.login_date AS report_date,
        COALESCE(idr.project_name, '-') AS project_name,
        att.total_hours AS hours,
        COALESCE(idr.work_done, '-') AS work_done,
        COALESCE(idr.section, '-') AS section,
        COALESCE(idr.created_at, '-') AS created_at,
        COALESCE(idr.updated_at, '-') AS updated_at,
        att.morning_in,
        att.morning_out,
        att.afternoon_in,
        att.afternoon_out
      FROM attendance att
      LEFT JOIN intern_dailyreport idr
        ON idr.employee_id = att.employee_id 
        AND idr.report_date = att.login_date
      WHERE att.login_date BETWEEN ? AND ?
    `;

    const params = [start_date, end_date];

    if (employee_id && employee_id !== "all") {
      query += ` AND att.employee_id = ?`;
      params.push(employee_id);
    }

    query += ` ORDER BY att.login_date DESC, idr.created_at DESC`;

    const reports = await queryWithRetry(query, params);

    res.json({
      success: true,
      count: reports.length,
      reports: reports,
    });
  } catch (error) {
    console.error("Get intern reports by date error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching intern reports by date",
      error: error.message,
    });
  }
});

// ✅ GET - Statistics/Summary
router.get("/statistics", async (req, res) => {
  try {
    const { employee_id, month, year } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_reports,
        SUM(hours) as total_hours,
        COUNT(DISTINCT employee_id) as total_employees,
        COUNT(DISTINCT project_name) as total_projects
      FROM intern_dailyreport
      WHERE 1=1
    `;

    const params = [];

    if (employee_id && employee_id !== "all") {
      query += ` AND employee_id = ?`;
      params.push(employee_id);
    }

    if (month && year) {
      query += ` AND MONTH(report_date) = ? AND YEAR(report_date) = ?`;
      params.push(parseInt(month), parseInt(year));
    }

    const stats = await queryWithRetry(query, params);

    res.json({
      success: true,
      statistics: stats[0],
    });
  } catch (error) {
    console.error("Get statistics error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching statistics",
      error: error.message,
    });
  }
});

module.exports = router;