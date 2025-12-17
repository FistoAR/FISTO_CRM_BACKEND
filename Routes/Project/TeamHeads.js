const express = require('express');
const router = express.Router();
const db = require('../../dataBase/connection');

// GET: Fetch all team heads from employees_details table
router.get('/team-heads', (req, res) => {
  console.log("GET /api/employees/team-heads called");

  const query = `
    SELECT 
      id,
      employee_id,
      employee_name as name,
      designation as department,
      profile_url as profile,
      email_official
    FROM employees_details
    WHERE team_head = 1 
      AND working_status = 'Active'
    ORDER BY employee_name ASC
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching team heads:", err);
      return res.status(500).json({
        status: 'error',
        message: 'Database error occurred',
        error: err.message
      });
    }

    console.log(`Found ${results.length} team heads`);

    res.json({
      status: 'success',
      data: results
    });
  });
});

// GET: Fetch all project owners by designation Admin, SBU, Project Head
router.get('/project-owners', (req, res) => {
  console.log("GET /api/employees/project-owners called");

  const query = `
    SELECT 
      id,
      employee_id,
      employee_name as name,
      designation as department,
      profile_url as profile,
      email_official
    FROM employees_details
    WHERE designation IN ('Admin', 'SBU', 'Project Head')
      AND working_status = 'Active'
    ORDER BY employee_name ASC
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching project owners:", err);
      return res.status(500).json({
        status: 'error',
        message: 'Database error occurred',
        error: err.message
      });
    }

    console.log(`Found ${results.length} project owners`);

    res.json({
      status: 'success',
      data: results
    });
  });
});

module.exports = router;
