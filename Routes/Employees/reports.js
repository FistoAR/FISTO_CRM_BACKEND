const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ===========================
// GET - Fetch Projects for Employee
// ===========================
router.get("/employee-projects/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    console.log("📥 Fetching projects for employee:", employeeId);
    console.log("🔍 Employee ID type:", typeof employeeId);
    
    // First, let's check all active projects for debugging
    const debugQuery = `
      SELECT id, project_name, employees 
      FROM projects 
      WHERE active = 1 AND end_date >= CURDATE()
    `;
    const allProjects = await queryWithRetry(debugQuery);
    console.log("🔍 Total active projects:", allProjects.length);
    
    // Log employee arrays for debugging
    allProjects.forEach(p => {
      try {
        const emps = JSON.parse(p.employees || '[]');
        console.log(`📋 Project: ${p.project_name}`);
        console.log(`   Employees:`, emps.map(e => `${e.id} (${e.name})`).join(', '));
        
        // Check if this employee exists
        const found = emps.find(e => e.id === employeeId);
        if (found) {
          console.log(`   ✅ Employee ${employeeId} FOUND in this project`);
        }
      } catch (e) {
        console.log(`   ⚠️ Error parsing employees for ${p.project_name}`);
      }
    });
    
    // Try primary query method
    const query1 = `
      SELECT 
        id,
        company_name,
        project_name,
        DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
        categories,
        description,
        employees
      FROM projects
      WHERE active = 1
      AND JSON_CONTAINS(employees, JSON_QUOTE(?), '$[*].id')
      AND end_date >= CURDATE()
      ORDER BY project_name ASC
    `;
    
    let projects = await queryWithRetry(query1, [employeeId]);
    console.log("✅ Method 1 (JSON_CONTAINS) found:", projects.length);
    
    // If no results, try alternative method using LIKE
    if (projects.length === 0) {
      console.log("⚠️ Trying alternative query method with LIKE...");
      
      const query2 = `
        SELECT 
          id,
          company_name,
          project_name,
          DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
          DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
          categories,
          description,
          employees
        FROM projects
        WHERE active = 1
        AND employees LIKE ?
        AND end_date >= CURDATE()
        ORDER BY project_name ASC
      `;
      
      projects = await queryWithRetry(query2, [`%"id":"${employeeId}"%`]);
      console.log("✅ Method 2 (LIKE) found:", projects.length);
    }
    
    if (projects.length > 0) {
      console.log("📋 Project names:", projects.map(p => p.project_name).join(', '));
    } else {
      console.log("⚠️ No projects found for employee:", employeeId);
    }
    
    // Parse employees JSON
    const parsedProjects = projects.map(project => ({
      id: project.id,
      name: project.project_name,
      companyName: project.company_name,
      startDate: project.start_date,
      endDate: project.end_date,
      categories: project.categories,
      description: project.description,
      employees: JSON.parse(project.employees || '[]')
    }));
    
    res.status(200).json({
      success: true,
      data: parsedProjects
    });
  } catch (error) {
    console.error("❌ Error fetching employee projects:", error);
    console.error("❌ Stack trace:", error.stack);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch projects: " + error.message 
    });
  }
});

// ===========================
// POST - Submit Report (Add Task)
// ===========================
router.post("/submit", async (req, res) => {
  try {
    console.log("📥 Received report submission:", req.body);
    
    const {
      employee_id,
      employee_name,
      date,
      project_id,
      project_name,
      start_date,
      end_date,
      today_task,
      progress = 0,
      status = 'In Progress',
      today_work = ''
    } = req.body;
    
    // Validation
    if (!employee_id || !employee_name || !date || !project_id || !today_task) {
      console.log("❌ Missing required fields");
      console.log("  - employee_id:", employee_id);
      console.log("  - employee_name:", employee_name);
      console.log("  - date:", date);
      console.log("  - project_id:", project_id);
      console.log("  - today_task:", today_task);
      
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields" 
      });
    }
    
    // Prepare JSON data
    const dateJson = JSON.stringify({
      date: date,
      formatted: formatDateToIST(date)
    });
    
    const taskJson = JSON.stringify({
      task: today_task,
      priority: 'Normal'
    });
    
    const workJson = JSON.stringify({
      work: today_work,
      hours: 0
    });
    
    console.log("💾 Inserting report into database...");
    console.log("  - Project:", project_name);
    console.log("  - Employee:", employee_name);
    console.log("  - Date:", date);
    
    // Insert report
    const insertQuery = `
      INSERT INTO employees_reports 
      (employee_id, employee_name, date, project_id, project_name, 
       start_date, end_date, today_task, progress, status, today_work) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const result = await queryWithRetry(insertQuery, [
      employee_id,
      employee_name,
      dateJson,
      project_id,
      project_name,
      start_date,
      end_date,
      taskJson,
      progress,
      status,
      workJson
    ]);
    
    console.log("✅ Report submitted with ID:", result.insertId);
    
    res.status(200).json({
      success: true,
      message: "Report submitted successfully",
      report_id: result.insertId
    });
  } catch (error) {
    console.error("❌ Error submitting report:", error);
    console.error("❌ Error stack:", error.stack);
    res.status(500).json({ 
      success: false, 
      error: "Failed to submit report: " + error.message 
    });
  }
});

// ===========================
// PUT - Update Report
// ===========================
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { today_task, progress, status, today_work } = req.body;
    
    console.log("📥 Updating report ID:", id);
    console.log("  - Task:", today_task);
    console.log("  - Progress:", progress);
    console.log("  - Status:", status);
    
    // Check if report exists
    const checkQuery = `SELECT id FROM employees_reports WHERE id = ?`;
    const existing = await queryWithRetry(checkQuery, [id]);
    
    if (existing.length === 0) {
      console.log("❌ Report not found");
      return res.status(404).json({ 
        success: false, 
        error: "Report not found" 
      });
    }
    
    // Prepare JSON updates
    const taskJson = JSON.stringify({
      task: today_task,
      priority: 'Normal'
    });
    
    const workJson = JSON.stringify({
      work: today_work || '',
      hours: 0
    });
    
    const updateQuery = `
      UPDATE employees_reports 
      SET today_task = ?, 
          progress = ?, 
          status = ?,
          today_work = ?
      WHERE id = ?
    `;
    
    await queryWithRetry(updateQuery, [taskJson, progress, status, workJson, id]);
    
    console.log("✅ Report updated successfully");
    
    res.status(200).json({
      success: true,
      message: "Report updated successfully"
    });
  } catch (error) {
    console.error("❌ Error updating report:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to update report: " + error.message 
    });
  }
});

// ===========================
// GET - Fetch Reports by Employee (MariaDB Compatible)
// ===========================
router.get("/employee-reports/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { limit = 100, offset = 0, startDate, endDate } = req.query;
    
    console.log("📥 Fetching reports for employee:", employeeId);
    console.log("📅 Date range:", { startDate, endDate });
    console.log("📄 Pagination:", { limit, offset });
    
    let query = `
      SELECT 
        id,
        employee_id,
        employee_name,
        JSON_UNQUOTE(JSON_EXTRACT(date, '$.date')) AS report_date,
        JSON_UNQUOTE(JSON_EXTRACT(date, '$.formatted')) AS formatted_date,
        project_id,
        project_name,
        DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
        JSON_UNQUOTE(JSON_EXTRACT(today_task, '$.task')) AS task,
        JSON_UNQUOTE(JSON_EXTRACT(today_task, '$.priority')) AS priority,
        progress,
        status,
        JSON_UNQUOTE(JSON_EXTRACT(today_work, '$.work')) AS work_done,
        JSON_UNQUOTE(JSON_EXTRACT(today_work, '$.hours')) AS hours_worked,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
      FROM employees_reports 
      WHERE employee_id = ?
    `;
    
    const params = [employeeId];
    
    if (startDate) {
      query += ` AND JSON_UNQUOTE(JSON_EXTRACT(date, '$.date')) >= ?`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND JSON_UNQUOTE(JSON_EXTRACT(date, '$.date')) <= ?`;
      params.push(endDate);
    }
    
    query += ` ORDER BY JSON_UNQUOTE(JSON_EXTRACT(date, '$.date')) DESC, created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    console.log("🔍 Executing query...");
    
    const reports = await queryWithRetry(query, params);
    
    console.log("✅ Found reports:", reports.length);
    
    if (reports.length > 0) {
      console.log("📊 Report dates:", reports.map(r => r.report_date).join(', '));
    }
    
    res.status(200).json({
      success: true,
      data: reports,
      count: reports.length
    });
  } catch (error) {
    console.error("❌ Error fetching reports:", error);
    console.error("❌ Error stack:", error.stack);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch reports: " + error.message 
    });
  }
});

// ===========================
// GET - Fetch Single Report by ID
// ===========================
router.get("/report/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log("📥 Fetching report ID:", id);
    
    const query = `
      SELECT 
        id,
        employee_id,
        employee_name,
        JSON_UNQUOTE(JSON_EXTRACT(date, '$.date')) AS report_date,
        JSON_UNQUOTE(JSON_EXTRACT(date, '$.formatted')) AS formatted_date,
        project_id,
        project_name,
        DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
        JSON_UNQUOTE(JSON_EXTRACT(today_task, '$.task')) AS task,
        JSON_UNQUOTE(JSON_EXTRACT(today_task, '$.priority')) AS priority,
        progress,
        status,
        JSON_UNQUOTE(JSON_EXTRACT(today_work, '$.work')) AS work_done,
        JSON_UNQUOTE(JSON_EXTRACT(today_work, '$.hours')) AS hours_worked,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
      FROM employees_reports 
      WHERE id = ?
    `;
    
    const reports = await queryWithRetry(query, [id]);
    
    if (reports.length === 0) {
      console.log("❌ Report not found");
      return res.status(404).json({ 
        success: false, 
        error: "Report not found" 
      });
    }
    
    console.log("✅ Report found");
    
    res.status(200).json({
      success: true,
      data: reports[0]
    });
  } catch (error) {
    console.error("❌ Error fetching report:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch report: " + error.message 
    });
  }
});

// ===========================
// DELETE - Delete Report
// ===========================
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log("🗑️ Deleting report ID:", id);
    
    const deleteQuery = `DELETE FROM employees_reports WHERE id = ?`;
    const result = await queryWithRetry(deleteQuery, [id]);
    
    if (result.affectedRows === 0) {
      console.log("❌ Report not found");
      return res.status(404).json({ 
        success: false, 
        error: "Report not found" 
      });
    }
    
    console.log("✅ Report deleted successfully");
    
    res.status(200).json({
      success: true,
      message: "Report deleted successfully"
    });
  } catch (error) {
    console.error("❌ Error deleting report:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to delete report: " + error.message 
    });
  }
});

// ===========================
// GET - Get Report Statistics
// ===========================
router.get("/stats/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    console.log("📊 Fetching statistics for employee:", employeeId);
    
    const query = `
      SELECT 
        COUNT(*) as total_reports,
        COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed_reports,
        COUNT(CASE WHEN status = 'In Progress' THEN 1 END) as in_progress_reports,
        AVG(progress) as average_progress
      FROM employees_reports
      WHERE employee_id = ?
    `;
    
    const stats = await queryWithRetry(query, [employeeId]);
    
    console.log("✅ Statistics fetched");
    
    res.status(200).json({
      success: true,
      data: stats[0]
    });
  } catch (error) {
    console.error("❌ Error fetching statistics:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch statistics: " + error.message 
    });
  }
});

// ===========================
// Helper Functions
// ===========================
function formatDateToIST(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

module.exports = router;
