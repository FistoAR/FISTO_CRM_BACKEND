const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");


// ===========================
// GET - Fetch Projects for Employee (Include "Other" Projects from Reports)
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
    
    // Try primary query method for regular projects
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
    
    // Get completed project IDs from reports
    const completedQuery = `
      SELECT project_id, project_name 
      FROM employees_reports 
      WHERE employee_id = ? 
      AND latest_status = 'Completed'
    `;
    const completedProjects = await queryWithRetry(completedQuery, [employeeId]);
    const completedIds = completedProjects.map(p => p.project_id);
    const completedNames = completedProjects.map(p => p.project_name);
    
    console.log("🚫 Completed project IDs:", completedIds);
    console.log("🚫 Completed project Names:", completedNames);
    
    // Filter out completed projects
    const activeProjects = projects.filter(p => !completedIds.includes(p.id));
    
    // Parse employees JSON
    let parsedProjects = activeProjects.map(project => ({
      id: project.id,
      name: project.project_name,
      companyName: project.company_name,
      startDate: project.start_date,
      endDate: project.end_date,
      categories: project.categories,
      description: project.description,
      employees: JSON.parse(project.employees || '[]'),
      source: 'projects_table'
    }));
    
    // ===========================
    // Fetch "Other" projects from employees_reports
    // ===========================
    const otherProjectsQuery = `
      SELECT 
        project_id,
        project_name,
        DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
        latest_status
      FROM employees_reports
      WHERE employee_id = ?
      AND project_id = 0
      AND latest_status != 'Completed'
      GROUP BY project_name
      ORDER BY project_name ASC
    `;
    
    const otherProjects = await queryWithRetry(otherProjectsQuery, [employeeId]);
    console.log("✅ Found 'Other' projects:", otherProjects.length);
    
    // Add "Other" projects to the list with unique IDs
    const otherParsedProjects = otherProjects.map((project) => ({
      id: `other_${project.project_name.replace(/\s+/g, '_')}`, // Unique ID based on project name
      name: project.project_name,
      companyName: 'N/A',
      startDate: project.start_date || null,
      endDate: project.end_date || null,
      categories: '',
      description: '',
      employees: [],
      source: 'other',
      actualProjectId: 0, // This is the real project_id in database
      projectName: project.project_name // Store original project name
    }));
    
    // Combine both lists
    parsedProjects = [...parsedProjects, ...otherParsedProjects];
    
    // Sort by project name
    parsedProjects.sort((a, b) => a.name.localeCompare(b.name));
    
    if (parsedProjects.length > 0) {
      console.log("📋 All project names:", parsedProjects.map(p => `${p.name} (${p.source})`).join(', '));
    } else {
      console.log("⚠️ No active projects found for employee:", employeeId);
    }
    
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
// GET - Fetch Latest Report for Project (for Update Task) - FIXED
// ===========================
router.get("/latest-report/:employeeId/:projectId", async (req, res) => {
  try {
    const { employeeId, projectId } = req.params;
    const { projectName } = req.query; // Get project name from query params
    
    console.log("📥 Fetching latest report for:", { employeeId, projectId, projectName });
    
    // Handle "Other" project
    const finalProjectId = (projectId === 'other' || projectId === '0') ? 0 : parseInt(projectId);
    
    let query;
    let params;
    
    // For "Other" projects (project_id = 0), also filter by project_name
    if (finalProjectId === 0 && projectName) {
      query = `
        SELECT 
          id,
          daily_reports,
          latest_status,
          latest_progress
        FROM employees_reports
        WHERE employee_id = ? AND project_id = ? AND project_name = ?
        LIMIT 1
      `;
      params = [employeeId, finalProjectId, projectName];
    } else {
      query = `
        SELECT 
          id,
          daily_reports,
          latest_status,
          latest_progress
        FROM employees_reports
        WHERE employee_id = ? AND project_id = ?
        LIMIT 1
      `;
      params = [employeeId, finalProjectId];
    }
    
    const reports = await queryWithRetry(query, params);
    
    if (reports.length > 0) {
      const dailyReports = JSON.parse(reports[0].daily_reports || '[]');
      const latestReport = dailyReports[dailyReports.length - 1] || null;
      
      console.log("✅ Latest report found:", latestReport);
      
      res.status(200).json({
        success: true,
        data: latestReport ? {
          task: latestReport.task,
          progress: reports[0].latest_progress,
          status: reports[0].latest_status
        } : null
      });
    } else {
      console.log("⚠️ No previous report found for this project");
      res.status(200).json({
        success: true,
        data: null
      });
    }
  } catch (error) {
    console.error("❌ Error fetching latest report:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch latest report: " + error.message 
    });
  }
});


// ===========================
// POST - Add Task (Creates New Entry or Adds Daily Task)
// ===========================
router.post("/add-task", async (req, res) => {
  try {
    console.log("📥 Received add task submission:", req.body);
    
    const {
      employee_id,
      employee_name,
      date,
      project_id,
      project_name,
      start_date,
      end_date,
      today_task
    } = req.body;
    
    // Validation
    if (!employee_id || !employee_name || !date || !today_task) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields" 
      });
    }
    
    // Handle "Other" project - use 0 as project_id
    const finalProjectId = (project_id === 'other' || project_id === 0 || !project_id) ? 0 : parseInt(project_id);
    const finalProjectName = project_name || 'Other';
    
    console.log("💾 Processing task addition...");
    console.log("  - Project ID:", finalProjectId);
    console.log("  - Project Name:", finalProjectName);
    console.log("  - Employee:", employee_name);
    console.log("  - Date:", date);
    
    // Check if project report already exists
    const checkQuery = `
      SELECT id, daily_reports 
      FROM employees_reports 
      WHERE employee_id = ? AND project_id = ? AND project_name = ?
    `;
    const existing = await queryWithRetry(checkQuery, [employee_id, finalProjectId, finalProjectName]);
    
    if (existing.length > 0) {
      // Project already exists - just add the daily task
      const dailyReports = JSON.parse(existing[0].daily_reports || '[]');
      
      // Check if task for today already exists
      const todayExists = dailyReports.some(r => r.date === date);
      if (todayExists) {
        console.log("⚠️ Task for today already exists");
        return res.status(400).json({
          success: false,
          error: "Task for today already exists. Please use Update Task."
        });
      }
      
      // Add new daily entry (without work_done for now)
      dailyReports.push({
        date: date,
        task: today_task,
        progress: 0,
        status: 'In Progress',
        work_done: ''
      });
      
      // Update existing record
      const updateQuery = `
        UPDATE employees_reports 
        SET daily_reports = ?
        WHERE id = ?
      `;
      
      await queryWithRetry(updateQuery, [
        JSON.stringify(dailyReports),
        existing[0].id
      ]);
      
      console.log("✅ Task added to existing project");
      
      res.status(200).json({
        success: true,
        message: "Task added successfully"
      });
    } else {
      // New project - create new record
      const dailyReports = [{
        date: date,
        task: today_task,
        progress: 0,
        status: 'In Progress',
        work_done: ''
      }];
      
      const insertQuery = `
        INSERT INTO employees_reports 
        (employee_id, employee_name, project_id, project_name, 
         start_date, end_date, daily_reports, latest_status, latest_progress) 
        VALUES (?, ?, ?, ?, ?, ?, ?, 'In Progress', 0)
      `;
      
      const result = await queryWithRetry(insertQuery, [
        employee_id,
        employee_name,
        finalProjectId,
        finalProjectName,
        start_date || null,
        end_date || null,
        JSON.stringify(dailyReports)
      ]);
      
      console.log("✅ New project report created with ID:", result.insertId);
      
      res.status(200).json({
        success: true,
        message: "Task added successfully",
        report_id: result.insertId
      });
    }
  } catch (error) {
    console.error("❌ Error adding task:", error);
    console.error("❌ Error stack:", error.stack);
    res.status(500).json({ 
      success: false, 
      error: "Failed to add task: " + error.message 
    });
  }
});


// ===========================
// POST - Update Task (Update Progress and Add Work Done) - FIXED
// ===========================
router.post("/update-task", async (req, res) => {
  try {
    console.log("📥 Received update task submission:", req.body);
    
    const {
      employee_id,
      date,
      project_id,
      project_name,
      progress,
      status,
      today_work
    } = req.body;
    
    // Validation
    if (!employee_id || !date || progress === undefined || !today_work) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields" 
      });
    }
    
    // Handle "Other" project
    const finalProjectId = (project_id === 'other' || project_id === '0' || project_id === 0) ? 0 : parseInt(project_id);
    
    console.log("💾 Processing task update...");
    console.log("  - Project ID:", finalProjectId);
    console.log("  - Project Name:", project_name);
    console.log("  - Date:", date);
    console.log("  - Progress:", progress);
    console.log("  - Status:", status);
    
    // Get existing report - for "Other" projects, also match by project_name
    let checkQuery, params;
    if (finalProjectId === 0 && project_name) {
      checkQuery = `
        SELECT id, daily_reports 
        FROM employees_reports 
        WHERE employee_id = ? AND project_id = ? AND project_name = ?
      `;
      params = [employee_id, finalProjectId, project_name];
    } else {
      checkQuery = `
        SELECT id, daily_reports 
        FROM employees_reports 
        WHERE employee_id = ? AND project_id = ?
      `;
      params = [employee_id, finalProjectId];
    }
    
    const existing = await queryWithRetry(checkQuery, params);
    
    if (existing.length === 0) {
      console.log("❌ Project not found");
      return res.status(404).json({
        success: false,
        error: "Project not found. Please add a task first."
      });
    }
    
    const dailyReports = JSON.parse(existing[0].daily_reports || '[]');
    
    // Find today's report
    const todayIndex = dailyReports.findIndex(r => r.date === date);
    
    if (todayIndex === -1) {
      console.log("❌ No task found for today");
      return res.status(404).json({
        success: false,
        error: "No task found for today. Please add a task first."
      });
    }
    
    // Update today's report
    dailyReports[todayIndex].progress = parseInt(progress);
    dailyReports[todayIndex].status = status;
    dailyReports[todayIndex].work_done = today_work;
    
    // Update database
    const updateQuery = `
      UPDATE employees_reports 
      SET daily_reports = ?,
          latest_status = ?,
          latest_progress = ?
      WHERE id = ?
    `;
    
    await queryWithRetry(updateQuery, [
      JSON.stringify(dailyReports),
      status,
      parseInt(progress),
      existing[0].id
    ]);
    
    console.log("✅ Task updated successfully");
    
    res.status(200).json({
      success: true,
      message: "Task updated successfully"
    });
  } catch (error) {
    console.error("❌ Error updating task:", error);
    console.error("❌ Error stack:", error.stack);
    res.status(500).json({ 
      success: false, 
      error: "Failed to update task: " + error.message 
    });
  }
});


// ===========================
// GET - Fetch All Reports by Employee (Flattened for Display)
// ===========================
router.get("/employee-reports/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { startDate, endDate } = req.query;
    
    console.log("📥 Fetching reports for employee:", employeeId);
    console.log("📅 Date range:", { startDate, endDate });
    
    let query = `
      SELECT 
        id,
        employee_id,
        employee_name,
        project_id,
        project_name,
        DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
        daily_reports,
        latest_status,
        latest_progress,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
      FROM employees_reports 
      WHERE employee_id = ?
      ORDER BY project_name ASC, updated_at DESC
    `;
    
    const reports = await queryWithRetry(query, [employeeId]);
    
    console.log("✅ Found project reports:", reports.length);
    
    // Parse daily reports and flatten for display
    const flattenedReports = [];
    
    reports.forEach(report => {
      const dailyReports = JSON.parse(report.daily_reports || '[]');
      
      dailyReports.forEach(daily => {
        // Apply date filter if specified
        if (startDate && daily.date < startDate) return;
        if (endDate && daily.date > endDate) return;
        
        // Only include reports with work_done (means they were updated)
        if (daily.work_done && daily.work_done.trim() !== '') {
          flattenedReports.push({
            id: report.id,
            project_id: report.project_id,
            project_name: report.project_name,
            report_date: daily.date,
            task: daily.task,
            progress: daily.progress,
            status: daily.status,
            work_done: daily.work_done,
            start_date: report.start_date,
            end_date: report.end_date
          });
        }
      });
    });
    
    console.log("✅ Flattened reports with work done:", flattenedReports.length);
    
    // Sort by project name and date
    flattenedReports.sort((a, b) => {
      if (a.project_name !== b.project_name) {
        return a.project_name.localeCompare(b.project_name);
      }
      return new Date(b.report_date) - new Date(a.report_date);
    });
    
    res.status(200).json({
      success: true,
      data: flattenedReports,
      count: flattenedReports.length
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
        project_id,
        project_name,
        DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
        daily_reports,
        latest_status,
        latest_progress,
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
    
    // Parse daily reports
    const report = reports[0];
    report.daily_reports = JSON.parse(report.daily_reports || '[]');
    
    console.log("✅ Report found");
    
    res.status(200).json({
      success: true,
      data: report
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
// DELETE - Delete Report (Entire Project)
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
        COUNT(*) as total_projects,
        COUNT(CASE WHEN latest_status = 'Completed' THEN 1 END) as completed_projects,
        COUNT(CASE WHEN latest_status = 'In Progress' THEN 1 END) as in_progress_projects,
        AVG(latest_progress) as average_progress
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