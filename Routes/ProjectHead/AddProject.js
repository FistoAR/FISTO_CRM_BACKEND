const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// Get all designations (for Team dropdown)
router.get("/designations", async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT designation 
      FROM employees_details 
      WHERE designation IS NOT NULL 
      AND designation != ''
      AND working_status = 'Active'
      ORDER BY designation ASC
    `;

    const designations = await queryWithRetry(query);

    res.status(200).json({
      success: true,
      data: designations.map((d) => ({
        id: d.designation,
        designation: d.designation,
      })),
    });
  } catch (error) {
    console.error("Error fetching designations:", error);
    res.status(500).json({ error: "Failed to fetch designations" });
  }
});

// ✅ MOVE THIS BEFORE /:id ROUTE
// Get all unique categories (for autocomplete)
router.get("/categories", async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT categories 
      FROM projects 
      WHERE categories IS NOT NULL 
      AND categories != ''
      AND active = 1
      ORDER BY categories ASC
    `;

    const results = await queryWithRetry(query);
    const categories = results.map((r) => r.categories);

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// Get all employees (for Employee dropdown)
router.get("/all-employees", async (req, res) => {
  try {
    const query = `
      SELECT 
        employee_id as id,
        employee_name as name,
        designation,
        email_official as email,
        phone_official as phone
      FROM employees_details 
      WHERE working_status = 'Active'
      ORDER BY employee_name ASC
    `;

    const employees = await queryWithRetry(query);

    res.status(200).json({
      success: true,
      data: employees,
    });
  } catch (error) {
    console.error("Error fetching all employees:", error);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

// Get project statistics (MOVE BEFORE /:id)
router.get("/stats/summary", async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_projects,
        COUNT(CASE WHEN end_date >= CURDATE() THEN 1 END) as active_projects,
        COUNT(CASE WHEN end_date < CURDATE() THEN 1 END) as completed_projects
      FROM projects
      WHERE active = 1
    `;

    const stats = await queryWithRetry(statsQuery);

    res.status(200).json({
      success: true,
      data: stats[0],
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// Get employees by designation
router.get("/employees/:designation", async (req, res) => {
  try {
    const { designation } = req.params;

    const query = `
      SELECT 
        employee_id as id,
        employee_name as name,
        designation,
        email_official as email,
        phone_official as phone
      FROM employees_details 
      WHERE designation = ?
      AND working_status = 'Active'
      ORDER BY employee_name ASC
    `;

    const employees = await queryWithRetry(query, [designation]);

    res.status(200).json({
      success: true,
      data: employees,
    });
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

// Get projects by employee (MOVE BEFORE /:id)
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const query = `
      SELECT 
        id,
        company_name,
        project_name,
        start_date,
        end_date,
        categories,
        description,
        team,
        employees,
        referral_code,
        created_at
      FROM projects
      WHERE active = 1
      AND JSON_CONTAINS(employees, JSON_QUOTE(?), '$[*].id')
      ORDER BY created_at DESC
    `;

    const projects = await queryWithRetry(query, [employeeId]);

    // Parse JSON fields
    const parsedProjects = projects.map((project) => ({
      ...project,
      team: JSON.parse(project.team),
      employees: JSON.parse(project.employees),
    }));

    res.status(200).json({
      success: true,
      data: parsedProjects,
    });
  } catch (error) {
    console.error("Error fetching employee projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Get projects by designation (MOVE BEFORE /:id)
router.get("/designation/:designation", async (req, res) => {
  try {
    const { designation } = req.params;

    const query = `
      SELECT 
        id,
        company_name,
        project_name,
        start_date,
        end_date,
        categories,
        description,
        team,
        employees,
        referral_code,
        created_at
      FROM projects
      WHERE active = 1
      AND JSON_CONTAINS(team, JSON_QUOTE(?), '$[*].designation')
      ORDER BY created_at DESC
    `;

    const projects = await queryWithRetry(query, [designation]);

    // Parse JSON fields
    const parsedProjects = projects.map((project) => ({
      ...project,
      team: JSON.parse(project.team),
      employees: JSON.parse(project.employees),
    }));

    res.status(200).json({
      success: true,
      data: parsedProjects,
    });
  } catch (error) {
    console.error("Error fetching designation projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Create new project
// Create new project
router.post("/", async (req, res) => {
  const {
    company_name,
    project_name,
    start_date,
    end_date,
    categories,
    description,
    team,
    employees,
    referral_code,
    created_by,
  } = req.body;

  console.log("📥 Received POST /api/projects");
  console.log("📦 Request Body:", req.body);

  // ✅ FIXED VALIDATION - Check for empty strings too
  if (!company_name || company_name.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "Company name is required",
    });
  }

  if (!project_name || project_name.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "Project name is required",
    });
  }

  if (!start_date) {
    return res.status(400).json({
      success: false,
      error: "Start date is required",
    });
  }

  if (!end_date) {
    return res.status(400).json({
      success: false,
      error: "End date is required",
    });
  }

  // ✅ FIX: Check for empty string specifically
  if (!categories || categories.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "Category is required",
    });
  }

  if (!description || description.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "Description is required",
    });
  }

  if (!Array.isArray(team) || team.length === 0) {
    return res.status(400).json({
      success: false,
      error: "At least one team designation is required",
    });
  }

  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({
      success: false,
      error: "At least one employee is required",
    });
  }

  try {
    // Store team and employees as JSON
    const teamJSON = JSON.stringify(team);
    const employeesJSON = JSON.stringify(employees);

    const projectResult = await queryWithRetry(
      `INSERT INTO projects (
        company_name, 
        project_name, 
        start_date, 
        end_date, 
        categories, 
        description,
        team,
        employees,
        referral_code,
        created_by,
        active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        company_name.trim(),
        project_name.trim(),
        start_date,
        end_date,
        categories.trim(),
        description.trim(),
        teamJSON,
        employeesJSON,
        referral_code || null,
        created_by || null,
      ]
    );

    const projectId = projectResult.insertId;

    console.log("✅ Project created successfully with ID:", projectId);

    res.status(200).json({
      success: true,
      message: "Project created successfully",
      projectId: projectId,
    });
  } catch (error) {
    console.error("❌ Error creating project:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create project: " + error.message,
    });
  }
});

// Get all projects
router.get("/", async (req, res) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT 
        p.id,
        p.company_name,
        p.project_name,
        DATE_FORMAT(p.start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(p.end_date, '%Y-%m-%d') as end_date,
        p.categories,
        p.description,
        p.team,
        p.employees,
        p.referral_code,
        p.created_by,
        e.employee_name as created_by_name,
        DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
      FROM projects p
      LEFT JOIN employees_details e ON p.created_by = e.employee_id
      WHERE p.active = 1
    `;

    const params = [];

    if (search) {
      query += ` AND (p.company_name LIKE ? OR p.project_name LIKE ? OR p.referral_code LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY p.created_at DESC`;

    const projects = await queryWithRetry(query, params);

    // Parse JSON fields
    const parsedProjects = projects.map((project) => ({
      ...project,
      team: JSON.parse(project.team),
      employees: JSON.parse(project.employees),
      all_employees: JSON.parse(project.employees),
    }));

    res.status(200).json({
      success: true,
      data: parsedProjects,
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// ⚠️ KEEP /:id ROUTES AT THE END
// Get single project by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const projectQuery = `
      SELECT 
        p.id,
        p.company_name,
        p.project_name,
        DATE_FORMAT(p.start_date, '%Y-%m-%d') as start_date,
        DATE_FORMAT(p.end_date, '%Y-%m-%d') as end_date,
        p.categories,
        p.description,
        p.team,
        p.employees,
        p.referral_code,
        p.created_by,
        e.employee_name as created_by_name,
        DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
      FROM projects p
      LEFT JOIN employees_details e ON p.created_by = e.employee_id
      WHERE p.id = ? AND p.active = 1
    `;

    const projects = await queryWithRetry(projectQuery, [id]);

    if (projects.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const project = projects[0];

    // Parse JSON fields
    project.team = JSON.parse(project.team);
    project.employees = JSON.parse(project.employees);
    project.all_employees = JSON.parse(project.employees);

    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (error) {
    console.error("Error fetching project:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// Update project
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    company_name,
    project_name,
    start_date,
    end_date,
    categories,
    description,
    team,
    employees,
    referral_code,
  } = req.body;

  // Validation
  if (!team || team.length === 0) {
    return res.status(400).json({
      error: "At least one team designation is required",
    });
  }

  if (!employees || employees.length === 0) {
    return res.status(400).json({
      error: "At least one employee is required",
    });
  }

  try {
    // Store team and employees as JSON
    const teamJSON = JSON.stringify(team);
    const employeesJSON = JSON.stringify(employees);

    await queryWithRetry(
      `UPDATE projects SET 
        company_name = ?,
        project_name = ?,
        start_date = ?,
        end_date = ?,
        categories = ?,
        description = ?,
        team = ?,
        employees = ?,
        referral_code = ?
      WHERE id = ? AND active = 1`,
      [
        company_name,
        project_name,
        start_date,
        end_date,
        categories,
        description,
        teamJSON,
        employeesJSON,
        referral_code || null,
        id,
      ]
    );

    res.status(200).json({
      success: true,
      message: "Project updated successfully",
    });
  } catch (error) {
    console.error("Error updating project:", error);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// Delete project
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Permanently delete from database
    await queryWithRetry(`DELETE FROM projects WHERE id = ?`, [id]);

    res.status(200).json({
      success: true,
      message: "Project deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

module.exports = router;
