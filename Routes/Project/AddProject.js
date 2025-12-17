const express = require('express');
const router = express.Router();
const db = require('../../dataBase/connection');

const safeStringify = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

const toSqlDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Helper function to generate next projectID
const getNextProjectID = (lastProjectID) => {
  if (!lastProjectID) return 'prj0001';
  const numPart = lastProjectID.replace('prj', '');
  const nextNum = parseInt(numPart, 10) + 1;
  return 'prj' + String(nextNum).padStart(4, '0');
};

// POST - Create new project
router.post('/', (req, res) => {
  try {
    let {
      companyName = '',
      employeeID = '',
      employeeName = '',
      projectName = '',
      priority = '',
      projectCategory = '',
      startDate = null,
      endDate = null,
      accessGrantedTo = [],
      projectDescription = ''
    } = req.body || {};

    if (!employeeID && req.session?.user) {
      employeeID = req.session.user.employee_id || req.session.user.id || employeeID;
    }
    if (!employeeName && req.session?.user) {
      employeeName = req.session.user.name || req.session.user.employee_name || employeeName;
    }

    if (typeof accessGrantedTo === 'string') {
      try { accessGrantedTo = JSON.parse(accessGrantedTo); } catch { accessGrantedTo = []; }
    }
    if (!Array.isArray(accessGrantedTo)) accessGrantedTo = [];

    const formattedAccess = accessGrantedTo.map((access) => {
      const empId = access.employeeId || access.employeeID || access.id || null;
      if (!empId) return null;
      const empName = access.employeeName || access.name || access.employee_name || "";
      const profile = access.profile || access.profilePath || access.profile_url || "";
      let updatedAt = access.updatedAt || access.updated_at || access.grantedAt || new Date().toISOString();
      try { updatedAt = new Date(updatedAt).toISOString(); } catch { updatedAt = new Date().toISOString(); }
      return {
        employeeId: empId,
        employeeName: empName,
        profile: profile,
        updatedAt: updatedAt
      };
    }).filter(Boolean);

    const accessJson = safeStringify(formattedAccess);
    const start_sql = toSqlDate(startDate);
    const end_sql = toSqlDate(endDate);

    if (!priority) {
      return res.status(400).json({ success: false, message: "Priority is required" });
    }

    const getLastProjectIDSql = 'SELECT projectID FROM Projects ORDER BY id DESC LIMIT 1';

    db.pool.query(getLastProjectIDSql, (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error fetching last projectID', error: err.message });
      }

      const lastProjectID = (rows && rows.length > 0) ? rows[0].projectID : null;
      const newProjectID = getNextProjectID(lastProjectID);

      const sql = `
        INSERT INTO Projects (
          projectID,
          companyName,
          employeeID,
          employeeName,
          projectName,
          priority,
          projectCategory,
          startDate,
          endDate,
          accessGrantedTo,
          projectDescription,
          createdAt,
          updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const params = [
        newProjectID,
        companyName || null,
        employeeID || null,
        employeeName || null,
        projectName || null,
        priority || null,
        projectCategory || null,
        start_sql,
        end_sql,
        accessJson,
        projectDescription || null
      ];

      db.pool.query(sql, params, (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error', error: err.message });
        }
        return res.status(201).json({
          success: true,
          message: 'Project created successfully',
          insertId: result.insertId,
          projectID: newProjectID
        });
      });
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

router.put('/:projectId', (req, res) => {
  const { projectId } = req.params;
  console.log('UPDATE called for projectId:', projectId, 'with body:', req.body);

  if (!projectId) {
    return res.status(400).json({ success: false, message: "Project ID is required" });
  }

  const findSql = 'SELECT * FROM Projects WHERE id = ? OR projectID = ? LIMIT 1';
  db.pool.query(findSql, [projectId, projectId], (findErr, findRows) => {
    if (findErr) {
      console.error('Error finding project:', findErr);
      return res.status(500).json({ success: false, message: 'Error finding project', error: findErr.message });
    }

    if (findRows.length === 0) {
      console.log('Project not found with given ID/projectID');
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const existingProject = findRows[0];
    console.log('Existing project:', existingProject);

    const bodyData = req.body || {};
    const updateFields = [];
    const updateValues = [];

    // Add ALL fields you want to be editable:

    if (bodyData.companyName !== undefined) {
      updateFields.push('companyName = ?');
      updateValues.push(bodyData.companyName || null);
    }

    if (bodyData.employeeID !== undefined) {
      updateFields.push('employeeID = ?');
      updateValues.push(bodyData.employeeID || null);
    }

    if (bodyData.employeeName !== undefined) {
      updateFields.push('employeeName = ?');
      updateValues.push(bodyData.employeeName || null);
    }

    if (bodyData.projectName !== undefined) {
      updateFields.push('projectName = ?');
      updateValues.push(bodyData.projectName || null);
    }

    if (bodyData.priority !== undefined) {
      updateFields.push('priority = ?');
      updateValues.push(bodyData.priority || null);
    }

    if (bodyData.projectCategory !== undefined) {
      updateFields.push('projectCategory = ?');
      updateValues.push(bodyData.projectCategory || null);
    }

    if (bodyData.startDate !== undefined) {
      updateFields.push('startDate = ?');
      updateValues.push(toSqlDate(bodyData.startDate));
    }

    if (bodyData.endDate !== undefined) {
      updateFields.push('endDate = ?');
      updateValues.push(toSqlDate(bodyData.endDate));
    }

    if (bodyData.accessGrantedTo !== undefined) {
      let accessGrantedTo = bodyData.accessGrantedTo;

      if (typeof accessGrantedTo === 'string') {
        try { accessGrantedTo = JSON.parse(accessGrantedTo); } catch { accessGrantedTo = []; }
      }
      if (!Array.isArray(accessGrantedTo)) accessGrantedTo = [];

      const formattedAccess = accessGrantedTo.map((access) => {
        const empId = access.employeeId || access.employeeID || access.id || null;
        if (!empId) return null;
        const empName = access.employeeName || access.name || access.employee_name || "";
        const profile = access.profile || access.profilePath || access.profile_url || "";
        let updatedAt = access.updatedAt || access.updated_at || access.grantedAt || new Date().toISOString();
        try { updatedAt = new Date(updatedAt).toISOString(); } catch { updatedAt = new Date().toISOString(); }
        return {
          employeeId: empId,
          employeeName: empName,
          profile,
          updatedAt,
        };
      }).filter(Boolean);

      updateFields.push('accessGrantedTo = ?');
      updateValues.push(safeStringify(formattedAccess));
    }

    if (bodyData.projectDescription !== undefined) {
      updateFields.push('projectDescription = ?');
      updateValues.push(bodyData.projectDescription || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields provided to update" });
    }

    updateFields.push('updatedAt = NOW()');

    const updateSql = `UPDATE Projects SET ${updateFields.join(', ')} WHERE projectID = ?`;
    updateValues.push(existingProject.projectID);

    console.log('Executing update:', updateSql);
    console.log('With params:', updateValues);

    db.pool.query(updateSql, updateValues, (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Update error:', updateErr);
        return res.status(500).json({ success: false, message: 'Database update error', error: updateErr.message });
      }

      console.log('Update result:', updateResult);

      if (updateResult.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Update failed, project not found" });
      }

      db.pool.query('SELECT * FROM Projects WHERE projectID = ?', [existingProject.projectID], (err, rows) => {
        if (err) {
          console.error('Fetch updated project error:', err);
          return res.status(500).json({ success: false, message: 'Error fetching updated project', error: err.message });
        }
        return res.status(200).json({ success: true, message: "Project updated", data: rows[0] });
      });
    });
  });
});



module.exports = router;
