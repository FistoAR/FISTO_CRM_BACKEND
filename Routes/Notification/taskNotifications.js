const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// Get employee details by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`📡 API: Fetching employee with ID: ${id}`);
    
    // Use queryWithRetry
    const employees = await queryWithRetry(
      `SELECT id, employee_id, employee_name, designation, team_head, working_status 
       FROM employees_details 
       WHERE employee_id = ? OR id = ?`,
      [id, id]
    );

    console.log(`📊 Query result:`, employees);

    if (!employees || employees.length === 0) {
      console.log(`❌ Employee not found: ${id}`);
      return res.status(404).json({
        success: false,
        error: 'Employee not found'
      });
    }

    console.log(`✅ Employee found:`, employees[0]);
    res.json({
      success: true,
      data: employees[0]
    });
  } catch (error) {
    console.error('❌ Error fetching employee:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employee details',
      details: error.message
    });
  }
});

module.exports = router;
