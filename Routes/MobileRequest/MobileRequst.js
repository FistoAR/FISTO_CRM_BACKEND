console.log("🚀 LOADING EmployeeRequests route...");

const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ========== HELPER FUNCTION: GET EMPLOYEES BY DESIGNATION ==========
async function getEmployeesByDesignation(designations) {
  try {
    const placeholders = designations.map(() => '?').join(',');
    const query = `
      SELECT employee_id, employee_name, designation 
      FROM employees_details 
      WHERE designation IN (${placeholders}) 
      AND working_status = 'Active'
    `;
    
    const results = await queryWithRetry(query, designations);
    console.log(`✅ Found ${results.length} employees with designations:`, designations);
    return results;
  } catch (error) {
    console.error("❌ Error fetching employees by designation:", error);
    return [];
  }
}

// ========== HELPER FUNCTION: SEND NOTIFICATIONS TO SPECIFIC USERS ==========
async function notifySpecificUsers(employeeIds, notificationData) {
  const io = global.io;
  const connectedUsers = global.connectedUsers;
  
  if (!io || !connectedUsers) {
    console.warn("⚠️ Socket.IO or connectedUsers not available");
    return 0;
  }

  let notifiedCount = 0;

  for (const employeeId of employeeIds) {
    const socketId = connectedUsers.get(employeeId);
    
    if (socketId) {
      try {
        io.to(socketId).emit('new-request-notification', notificationData);
        console.log(`✅ Notification sent to ${employeeId} (Socket: ${socketId})`);
        notifiedCount++;
      } catch (error) {
        console.error(`❌ Failed to send notification to ${employeeId}:`, error);
      }
    } else {
      console.log(`📴 ${employeeId} is not connected (notification saved to DB)`);
    }

    // Save notification to database for persistence
    try {
      await queryWithRetry(
        `INSERT INTO user_notifications 
         (employee_id, notification_id, notification_data, is_read, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         notification_data = VALUES(notification_data)`,
        [
          employeeId,
          notificationData.id,
          JSON.stringify(notificationData),
          0,
          notificationData.timestamp
        ]
      );
      console.log(`💾 Notification saved to DB for ${employeeId}`);
    } catch (err) {
      console.error(`❌ Failed to save notification to DB for ${employeeId}:`, err);
    }
  }

  return notifiedCount;
}

// ========== LEAVE REQUESTS - FIXED ✅ ==========
router.post("/leave-requests", async (req, res) => {
  console.log("✅ LEAVE REQUEST HIT!");
  try {
    // ✅ FIXED: Use selected employee from headers (priority)
    const targetEmployeeId = req.headers['x-target-employee-id'];
    const targetEmployeeName = req.headers['x-target-employee-name'];
    
    // Fallback to userData only if headers missing
    const userData = JSON.parse(req.headers['x-user-data'] || '{}');
    const employee_id = targetEmployeeId || userData.userName || 'FST001';
    const employee_name = targetEmployeeName || userData.employeeName || employee_id;
    
    console.log(`📝 Request for Employee: ${employee_name} (${employee_id})`);
    
    const { leave_type, from_date, to_date, number_of_days, reason } = req.body;

    if (!leave_type || !from_date || !number_of_days || !reason?.trim()) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // ✅ STORES SELECTED EMPLOYEE ID IN DB
    const result = await queryWithRetry(
      `INSERT INTO leave_requests 
       (employee_id, leave_type, from_date, to_date, number_of_days, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [employee_id, leave_type, from_date, to_date || null, parseInt(number_of_days), reason.trim()]
    );

    console.log(`✅ Leave request created for ${employee_name} (${employee_id}) with ID: ${result.insertId}`);

    // Get approvers
    const targetEmployees = await getEmployeesByDesignation([
      'Admin', 
      'Digital Marketing & HR', 
      'Project Head'
    ]);

    // Notification data with correct employee info
    const notificationData = {
      id: `leave_${result.insertId}_${Date.now()}`,
      title: "🔔 New Leave Request",
      type: "leave",
      requestType: "new_request",
      status: "pending",
      data: {
        requestId: result.insertId,
        employee_id: employee_id,
        employee_name: employee_name,
        leaveType: leave_type,
        fromDate: from_date,
        toDate: to_date,
        numberOfDays: number_of_days,
        reason: reason.trim(),
        type: "leave"
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    const employeeIds = targetEmployees.map(emp => emp.employee_id);
    const notifiedCount = await notifySpecificUsers(employeeIds, notificationData);

    console.log(`📢 Notified ${notifiedCount}/${targetEmployees.length} employees online`);

    res.json({
      success: true,
      message: `Leave request submitted successfully for ${employee_name}`,
      leaveRequestId: result.insertId,
      employee_id: employee_id,
      employee_name: employee_name,
      notified_count: notifiedCount,
      total_recipients: targetEmployees.length
    });
  } catch (err) {
    console.error("❌ Leave request error:", err);
    res.status(500).json({ success: false, error: "Failed to create leave request" });
  }
});

// ========== PERMISSION REQUESTS - FIXED ✅ ==========
router.post("/permission-requests", async (req, res) => {
  console.log("✅ PERMISSION REQUEST HIT!");
  try {
    // ✅ FIXED: Use selected employee from headers (priority)
    const targetEmployeeId = req.headers['x-target-employee-id'];
    const targetEmployeeName = req.headers['x-target-employee-name'];
    
    // Fallback to userData only if headers missing
    const userData = JSON.parse(req.headers['x-user-data'] || '{}');
    const employee_id = targetEmployeeId || userData.userName || 'FST001';
    const employee_name = targetEmployeeName || userData.employeeName || employee_id;
    
    console.log(`📝 Permission request for Employee: ${employee_name} (${employee_id})`);
    
    const { permission_date, from_time, to_time, duration_minutes, reason } = req.body;

    if (!permission_date || !from_time || !to_time || !reason?.trim()) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // ✅ STORES SELECTED EMPLOYEE ID IN DB
    const result = await queryWithRetry(
      `INSERT INTO permission_requests 
       (employee_id, permission_date, from_time, to_time, duration_minutes, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [employee_id, permission_date, from_time, to_time, parseFloat(duration_minutes), reason.trim()]
    );

    console.log(`✅ Permission request created for ${employee_name} (${employee_id}) with ID: ${result.insertId}`);

    // Get approvers
    const targetEmployees = await getEmployeesByDesignation([
      'Admin', 
      'Digital Marketing & HR', 
      'Project Head'
    ]);

    // Notification data with correct employee info
    const notificationData = {
      id: `permission_${result.insertId}_${Date.now()}`,
      title: "🔔 New Permission Request",
      type: "permission",
      requestType: "new_request",
      status: "pending",
      data: {
        requestId: result.insertId,
        employee_id: employee_id,
        employee_name: employee_name,
        permissionDate: permission_date,
        fromTime: from_time,
        toTime: to_time,
        duration: duration_minutes,
        reason: reason.trim(),
        type: "permission"
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    const employeeIds = targetEmployees.map(emp => emp.employee_id);
    const notifiedCount = await notifySpecificUsers(employeeIds, notificationData);

    console.log(`📢 Notified ${notifiedCount}/${targetEmployees.length} employees online`);

    res.json({
      success: true,
      message: `Permission request submitted successfully for ${employee_name}`,
      permissionRequestId: result.insertId,
      employee_id: employee_id,
      employee_name: employee_name,
      notified_count: notifiedCount,
      total_recipients: targetEmployees.length
    });
  } catch (err) {
    console.error("❌ Permission request error:", err);
    res.status(500).json({ success: false, error: "Failed to create permission request" });
  }
});


// ========== GET EMPLOYEES FOR ATTENDEES DROPDOWN ==========
router.get("/employees", async (req, res) => {
  console.log("✅ GET EMPLOYEES HIT!");
  try {
    const results = await queryWithRetry(
      `SELECT employee_id, employee_name FROM employees_details 
       WHERE working_status = 'Active' 
       ORDER BY employee_name ASC`
    );

    res.json({
      success: true,
      employees: results.map(emp => ({
        employee_id: emp.employee_id,
        employee_name: emp.employee_name
      }))
    });
  } catch (err) {
    console.error("❌ Get employees error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch employees" });
  }
});

// ========== TEST ROUTE ==========
router.get("/test", (req, res) => {
  console.log("✅ TEST ROUTE WORKS!");
  res.json({ success: true, message: "Employee Requests route LOADED!" });
});

module.exports = router;
console.log("✅ EmployeeRequests EXPORTED!");
