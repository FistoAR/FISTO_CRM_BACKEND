const express = require('express');
const router = express.Router();
const db = require('../../dataBase/connection');

router.get('/getAllEmployees', (req, res) => {
  console.log('✅ getAllEmployees route hit!');
  
  const sql = `
    SELECT 
      id,
      employee_id,
      employee_name,
      designation,
      email_official,
      profile_url
    FROM employees_details
  `;

  db.pool.query(sql, (err, rows) => {
    if (err) {
      console.error('Database error fetching employees:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error fetching employees',
        error: err.message
      });
    }

    console.log('✅ Employees fetched successfully:', rows.length);
    return res.status(200).json({
      success: true,
      employees: rows
    });
  });
});

router.get('/:projectId', (req, res) => {
  const { projectId } = req.params;
  console.log('📋 Project route hit with ID:', projectId);

  if (!projectId) {
    return res
      .status(400)
      .json({ success: false, message: 'Project ID is required' });
  }

  const findProjectSql = `
    SELECT *
    FROM Projects
    WHERE id = ? OR projectID = ?
    LIMIT 1
  `;

  db.pool.query(findProjectSql, [projectId, projectId], (err, rows) => {
    if (err) {
      console.error('Database error fetching project:', err);
      return res.status(500).json({
        success: false,
        message: 'DB error fetching project',
        error: err.message,
      });
    }

    if (!rows || rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Project not found' });
    }

    const project = rows[0];

    // Parse accessGrantedTo
    let accessArr = project.accessGrantedTo;
    if (typeof accessArr === 'string') {
      try {
        accessArr = JSON.parse(accessArr);
      } catch {
        accessArr = [];
      }
    }
    if (!Array.isArray(accessArr)) accessArr = [];

    // Admin from first accessGrantedTo entry
    let creatorObj = null;
    if (accessArr.length > 0) {
      const first = accessArr[0];
      creatorObj = {
        name: first.employeeName || first.name || '',
        profile: first.profile || '',
        employeeId: first.employeeId || first.employeeID || null,
      };
    }

    // Initiated from project table
    const createdBy = {
      name: project.employeeName || '',
      profile: '',
      employeeId: project.employeeID || null,
    };

    console.log('✅ Project fetched successfully:', project.projectName || projectId);
    return res.status(200).json({
      success: true,
      data: {
        ...project,
        accessGrantedTo: accessArr,
        createdBy,
        creator: creatorObj,
      },
    });
  });
});

module.exports = router;
