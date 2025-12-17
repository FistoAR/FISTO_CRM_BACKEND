const express = require('express');
const router = express.Router();
const db = require('../../dataBase/connection');

// Update project employees - saves to assignedEmp JSON field
router.put('/updateEmployees', (req, res) => {
  const { projectId, employees } = req.body;

  console.log('📝 Updating employees for project:', projectId);
  console.log('Selected employees:', employees);

  if (!projectId || !Array.isArray(employees)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Project ID and employees array are required' 
    });
  }

  // Format employees for assignedEmp field with updatedAt timestamp
  const assignedEmp = employees.map(emp => ({
    employeeId: emp.id || emp.employee_id,
    employeeName: emp.name || emp.employee_name,
    profile: emp.profile || emp.profile_url || '',
    updatedAt: new Date().toISOString(),
  }));

  const assignedEmpStr = JSON.stringify(assignedEmp);

  const sql = `
    UPDATE Projects 
    SET assignedEmp = ?, updatedAt = CURRENT_TIMESTAMP 
    WHERE id = ? OR projectID = ?
  `;

  db.pool.query(sql, [assignedEmpStr, projectId, projectId], (err, result) => {
    if (err) {
      console.error('❌ Database error updating assignedEmp:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Database update failed', 
        error: err.message 
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }

    console.log('✅ Employees updated successfully for project:', projectId);
    console.log('Saved to assignedEmp:', assignedEmp.length, 'employees');
    
    return res.status(200).json({ 
      success: true, 
      message: 'Employees updated successfully', 
      data: { employees: assignedEmp, count: assignedEmp.length }
    });
  });
});

// Check if employee has progress (tasks/activities) before removal
router.post('/checkEmployeeProgress', (req, res) => {
  const { projectId, employeeId } = req.body;

  console.log('🔍 Checking progress for employee:', employeeId, 'in project:', projectId);

  if (!projectId || !employeeId) {
    return res.status(400).json({ 
      success: false, 
      message: 'Project ID and employee ID required' 
    });
  }

  const checkSql = `
    SELECT 
      t.id as task_id,
      a.id as activity_id
    FROM Tasks t 
    LEFT JOIN Activities a ON a.taskId = t.id
    WHERE t.projectId = ? AND (t.employee = ? OR a.employee = ?)
    LIMIT 1
  `;

  db.pool.query(checkSql, [projectId, employeeId, employeeId], (err, rows) => {
    if (err) {
      console.error('❌ Error checking employee progress:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error', 
        error: err.message 
      });
    }

    const hasProgress = rows.length > 0;
    
    console.log('Progress check result:', hasProgress ? 'HAS WORK' : 'NO WORK');

    return res.status(200).json({ 
      success: true, 
      canRemove: !hasProgress,
      justAssigned: hasProgress,
      message: hasProgress ? 'Employee has assigned tasks/activities' : 'Employee can be safely removed'
    });
  });
});

// Remove employee tasks (when they have progress but we want to delete anyway)
router.delete('/removeEmployeeTasks', (req, res) => {
  const { projectId, employeeId } = req.body;

  console.log('🗑️ Removing all tasks/activities for employee:', employeeId, 'from project:', projectId);

  // First delete activities
  const deleteActivitiesSql = `
    DELETE a FROM Activities a
    JOIN Tasks t ON a.taskId = t.id
    WHERE t.projectId = ? AND a.employee = ?
  `;

  // Then delete tasks assigned to employee
  const deleteTasksSql = `
    DELETE FROM Tasks 
    WHERE projectId = ? AND employee = ?
  `;

  db.pool.query(deleteActivitiesSql, [projectId, employeeId], (err1) => {
    if (err1) {
      console.error('❌ Error deleting activities:', err1);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to delete activities' 
      });
    }

    db.pool.query(deleteTasksSql, [projectId, employeeId], (err2, result) => {
      if (err2) {
        console.error('❌ Error deleting tasks:', err2);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to delete tasks' 
        });
      }

      console.log('✅ Removed', result.affectedRows, 'tasks for employee');
      return res.status(200).json({ 
        success: true, 
        message: 'Employee tasks removed successfully',
        deletedCount: result.affectedRows
      });
    });
  });
});

module.exports = router;
