const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ✅ GET - All intern reports with attendance data (Time In/Time Out)
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

    // Filter by employee if provided
    if (employee_id && employee_id !== "all") {
      query += ` AND idr.employee_id = ?`;
      params.push(employee_id);
    }

    // Filter by date range if provided
    if (start_date) {
      query += ` AND idr.report_date >= ?`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND idr.report_date <= ?`;
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

// ✅ GET - Intern reports by date range (with attendance)
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
      WHERE idr.report_date BETWEEN ? AND ?
    `;

    const params = [start_date, end_date];

    if (employee_id && employee_id !== "all") {
      query += ` AND idr.employee_id = ?`;
      params.push(employee_id);
    }

    query += ` ORDER BY idr.report_date DESC, idr.created_at DESC`;

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

// ✅ POST - Export intern reports to PDF (with attendance)
router.post("/export-pdf", async (req, res) => {
  try {
    const { employee_id, start_date, end_date } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: "start_date and end_date are required",
      });
    }

    let query = `
  SELECT 
    idr.employee_id,
    idr.employee_name,
    idr.report_date,
    idr.project_name,
    idr.hours,
    idr.work_done,
    idr.section,
    att.morning_in,
    att.morning_out,
    att.afternoon_in,
    att.afternoon_out
  FROM intern_dailyreport idr
  LEFT JOIN attendance att 
    ON idr.employee_id = att.employee_id 
    AND idr.report_date = att.login_date
  WHERE 1=1
`;

    const params = [];

    if (employee_id && employee_id !== "all") {
      query += ` AND idr.employee_id = ?`;
      params.push(employee_id);
    }

    if (start_date) {
      query += ` AND idr.report_date >= ?`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND idr.report_date <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY idr.report_date ASC, idr.employee_id ASC`;

    const reports = await queryWithRetry(query, params);

    const reportMap = new Map();
    const employeesMap = new Map();

    reports.forEach((r) => {
      const reportDate =
        typeof r.report_date === "string"
          ? r.report_date.split("T")[0]
          : new Date(r.report_date).toISOString().slice(0, 10);

      const key = `${r.employee_id}_${reportDate}`;
      reportMap.set(key, r);

      if (r.employee_id) {
        employeesMap.set(r.employee_id, r.employee_name);
      }
    });

    if ((!employee_id || employee_id === "all") && employeesMap.size === 0) {
      return res.status(404).json({
        success: false,
        message: "No employees found for the given criteria",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDateObj = new Date(end_date);
    endDateObj.setHours(0, 0, 0, 0);

    const start = new Date(start_date);
    start.setHours(0, 0, 0, 0);
    let current = new Date(start);

    const fullData = [];

    while (current <= endDateObj) {
      const isoDate = current.toISOString().slice(0, 10);
      const dayOfWeek = current.getDay();
      const isSunday = dayOfWeek === 0;
      const isFuture = current > today;

      if (employee_id && employee_id !== "all") {
        const key = `${employee_id}_${isoDate}`;
        const row = reportMap.get(key);

        if (row) {
          fullData.push(row);
        } else if (isSunday) {
          fullData.push({
            employee_id,
            employee_name: reports[0]?.employee_name || "",
            report_date: isoDate,
            project_name: "Holiday",
            hours: 0,
            work_done: "Sunday Holiday",
            section: "-",
            time_in: null,
            time_out: null,
          });
        } else if (isFuture) {
          // Future date -> Upcoming
          fullData.push({
            employee_id,
            employee_name: reports[0]?.employee_name || "",
            report_date: isoDate,
            project_name: "Upcoming",
            hours: 0,
            work_done: "Upcoming",
            section: "-",
            time_in: null,
            time_out: null,
          });
        } else {
          // Past date -> Leave
          fullData.push({
            employee_id,
            employee_name: reports[0]?.employee_name || "",
            report_date: isoDate,
            project_name: "Leave",
            hours: 0,
            work_done: "Leave",
            section: "-",
            time_in: null,
            time_out: null,
          });
        }
      } else {
        employeesMap.forEach((empName, empId) => {
          const key = `${empId}_${isoDate}`;
          const row = reportMap.get(key);

          if (row) {
            fullData.push(row);
          } else if (isSunday) {
            fullData.push({
              employee_id: empId,
              employee_name: empName,
              report_date: isoDate,
              project_name: "Holiday",
              hours: 0,
              work_done: "Sunday Holiday",
              section: "-",
              time_in: null,
              time_out: null,
            });
          } else if (isFuture) {
            fullData.push({
              employee_id: empId,
              employee_name: empName,
              report_date: isoDate,
              project_name: "Upcoming",
              hours: 0,
              work_done: "Upcoming",
              section: "-",
              time_in: null,
              time_out: null,
            });
          } else {
            fullData.push({
              employee_id: empId,
              employee_name: empName,
              report_date: isoDate,
              project_name: "Leave",
              hours: 0,
              work_done: "Leave",
              section: "-",
              time_in: null,
              time_out: null,
            });
          }
        });
      }

      current.setDate(current.getDate() + 1);
    }

    if (fullData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No reports found for the given criteria",
      });
    }

    res.json({
      success: true,
      message: "PDF data prepared",
      count: fullData.length,
      data: fullData,
    });
  } catch (error) {
    console.error("Export PDF error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating PDF",
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
