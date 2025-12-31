console.log("🚀 LOADING HR route...");

const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ========== GET ALL LEAVE REQUESTS ==========
router.get("/leave-requests", async (req, res) => {
  console.log("✅ GET LEAVE REQUESTS HIT!");
  try {
    const query = `
      SELECT 
        lr.id,
        lr.employee_id,
        lr.leave_type,
        lr.from_date,
        lr.to_date,
        lr.number_of_days,
        lr.reason,
        lr.status,
        lr.approved_by,         
        lr.created_at,
        lr.updated_at,
        ed.employee_name,
        ed.profile_url
      FROM leave_requests lr
      LEFT JOIN employees_details ed ON lr.employee_id = ed.employee_id
      ORDER BY 
        CASE 
          WHEN lr.status = 'pending' THEN 0 
          WHEN lr.status = 'approved' THEN 1 
          WHEN lr.status = 'rejected' THEN 2 
        END ASC,
        lr.created_at DESC
    `;

    const results = await queryWithRetry(query);

    const formattedResults = results.map((row) => ({
      id: row.id,
      employee_id: row.employee_id,
      employee_name: row.employee_name || row.employee_id,
      profile_url: row.profile_url || null,
      leave_type: row.leave_type,
      from_date: row.from_date ? new Date(row.from_date).toISOString().split("T")[0] : null,
      to_date: row.to_date ? new Date(row.to_date).toISOString().split("T")[0] : null,
      number_of_days: row.number_of_days,
      reason: row.reason,
      status: row.status,
      approved_by: row.approved_by || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    console.log(`✅ Found ${formattedResults.length} leave requests`);
    res.json({ success: true, requests: formattedResults });
  } catch (err) {
    console.error("Get leave requests error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch leave requests" });
  }
});

// ========== GET ALL PERMISSION REQUESTS ==========
router.get("/permission-requests", async (req, res) => {
  console.log("✅ GET PERMISSION REQUESTS HIT!");
  try {
    const query = `
      SELECT 
        pr.id,
        pr.employee_id,
        pr.permission_date,
        pr.from_time,
        pr.to_time,
        pr.duration_minutes,
        pr.reason,
        pr.status,
        pr.approved_by,          
        pr.created_at,
        pr.updated_at,
        ed.employee_name,
        ed.profile_url
      FROM permission_requests pr
      LEFT JOIN employees_details ed ON pr.employee_id = ed.employee_id
      ORDER BY 
        CASE 
          WHEN pr.status = 'pending' THEN 0 
          WHEN pr.status = 'approved' THEN 1 
          WHEN pr.status = 'rejected' THEN 2 
        END ASC,
        pr.created_at DESC
    `;

    const results = await queryWithRetry(query);

    const formattedResults = results.map((row) => ({
      id: row.id,
      employee_id: row.employee_id,
      employee_name: row.employee_name || row.employee_id,
      profile_url: row.profile_url || null,
      permission_date: row.permission_date ? new Date(row.permission_date).toISOString().split("T")[0] : null,
      from_time: row.from_time ? row.from_time.toString().slice(0, 5) : null,
      to_time: row.to_time ? row.to_time.toString().slice(0, 5) : null,
      duration_minutes: row.duration_minutes,
      reason: row.reason,
      status: row.status,
      approved_by: row.approved_by || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    console.log(`✅ Found ${formattedResults.length} permission requests`);
    res.json({ success: true, requests: formattedResults });
  } catch (err) {
    console.error("Get permission requests error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch permission requests" });
  }
});

// ========== APPROVE LEAVE REQUEST (WITH SOCKET.IO) ==========
router.patch("/leave-requests/:id/approve", async (req, res) => {
  console.log("✅ APPROVE LEAVE REQUEST HIT! ID:", req.params.id);
  
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    console.log("Approving leave request:", { id, approvedBy });

    // FIRST: Get the request details BEFORE updating
    const requestDetails = await queryWithRetry(
      `SELECT lr.*, ed.employee_name 
       FROM leave_requests lr
       LEFT JOIN employees_details ed ON lr.employee_id = ed.employee_id
       WHERE lr.id = ?`,
      [id]
    );

    if (!requestDetails || requestDetails.length === 0) {
      console.log("❌ Request not found:", id);
      return res.status(404).json({ success: false, error: "Request not found" });
    }

    const request = requestDetails[0];
    console.log("Found request:", request);

    // SECOND: Update the status in database
    await queryWithRetry(
      `UPDATE leave_requests 
       SET status = 'approved', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id]
    );

    console.log("✅ Leave request approved in database");

    // THIRD: Send Socket.IO notification
    const io = global.io;
    const connectedUsers = global.connectedUsers;
    
    if (io && connectedUsers) {
      const targetEmployeeId = request.employee_id;
      console.log("Checking if user is connected:", targetEmployeeId);
      console.log("Connected users:", Array.from(connectedUsers.keys()));

      if (connectedUsers.has(targetEmployeeId)) {
        const socketId = connectedUsers.get(targetEmployeeId);
        
        io.to(socketId).emit("request-approved", {
          type: "leave",
          requestId: id,
          leaveType: request.leave_type,
          numberOfDays: request.number_of_days,
          fromDate: request.from_date,
          toDate: request.to_date,
          approvedBy: approvedBy,
          timestamp: new Date().toISOString(),
        });

        console.log(`🔔 Notification sent to ${targetEmployeeId} (Socket: ${socketId})`);
      } else {
        console.log(`⚠️ User ${targetEmployeeId} not connected`);
      }
    } else {
      console.log("⚠️ Socket.IO not initialized");
    }

    res.json({
      success: true,
      message: "Leave request approved successfully",
      notificationSent: connectedUsers && connectedUsers.has(request.employee_id),
    });
  } catch (err) {
    console.error("❌ Approve leave error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to approve leave request",
      details: err.message 
    });
  }
});

// ========== REJECT LEAVE REQUEST (WITH SOCKET.IO) ==========
router.patch("/leave-requests/:id/reject", async (req, res) => {
  console.log("✅ REJECT LEAVE REQUEST HIT! ID:", req.params.id);
  
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    // Get request details BEFORE updating
    const requestDetails = await queryWithRetry(
      `SELECT lr.*, ed.employee_name 
       FROM leave_requests lr
       LEFT JOIN employees_details ed ON lr.employee_id = ed.employee_id
       WHERE lr.id = ?`,
      [id]
    );

    if (!requestDetails || requestDetails.length === 0) {
      return res.status(404).json({ success: false, error: "Request not found" });
    }

    const request = requestDetails[0];

    // Update status
    await queryWithRetry(
      `UPDATE leave_requests 
       SET status = 'rejected', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id]
    );

    console.log("✅ Leave request rejected in database");

    // Send Socket.IO notification
    const io = global.io;
    const connectedUsers = global.connectedUsers;
    const targetEmployeeId = request.employee_id;

    if (io && connectedUsers && connectedUsers.has(targetEmployeeId)) {
      const socketId = connectedUsers.get(targetEmployeeId);
      
      io.to(socketId).emit("request-rejected", {
        type: "leave",
        requestId: id,
        leaveType: request.leave_type,
        numberOfDays: request.number_of_days,
        fromDate: request.from_date,
        toDate: request.to_date,
        rejectedBy: approvedBy,
        timestamp: new Date().toISOString(),
      });

      console.log(`🔔 Rejection notification sent to ${targetEmployeeId}`);
    }

    res.json({
      success: true,
      message: "Leave request rejected successfully",
      notificationSent: connectedUsers && connectedUsers.has(request.employee_id),
    });
  } catch (err) {
    console.error("❌ Reject leave error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to reject leave request",
      details: err.message 
    });
  }
});

// ========== APPROVE PERMISSION REQUEST (WITH SOCKET.IO) ==========
router.patch("/permission-requests/:id/approve", async (req, res) => {
  console.log("✅ APPROVE PERMISSION REQUEST HIT! ID:", req.params.id);
  
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    // Get request details BEFORE updating
    const requestDetails = await queryWithRetry(
      `SELECT pr.*, ed.employee_name 
       FROM permission_requests pr
       LEFT JOIN employees_details ed ON pr.employee_id = ed.employee_id
       WHERE pr.id = ?`,
      [id]
    );

    if (!requestDetails || requestDetails.length === 0) {
      return res.status(404).json({ success: false, error: "Request not found" });
    }

    const request = requestDetails[0];

    // Update status
    await queryWithRetry(
      `UPDATE permission_requests 
       SET status = 'approved', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id]
    );

    console.log("✅ Permission request approved in database");

    // Send Socket.IO notification
    const io = global.io;
    const connectedUsers = global.connectedUsers;
    const targetEmployeeId = request.employee_id;

    if (io && connectedUsers && connectedUsers.has(targetEmployeeId)) {
      const socketId = connectedUsers.get(targetEmployeeId);
      
      io.to(socketId).emit("request-approved", {
        type: "permission",
        requestId: id,
        permissionDate: request.permission_date,
        fromTime: request.from_time,
        toTime: request.to_time,
        duration: request.duration_minutes,
        approvedBy: approvedBy,
        timestamp: new Date().toISOString(),
      });

      console.log(`🔔 Permission approval sent to ${targetEmployeeId}`);
    }

    res.json({
      success: true,
      message: "Permission request approved successfully",
      notificationSent: connectedUsers && connectedUsers.has(request.employee_id),
    });
  } catch (err) {
    console.error("❌ Approve permission error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to approve permission request",
      details: err.message 
    });
  }
});

// ========== REJECT PERMISSION REQUEST (WITH SOCKET.IO) ==========
router.patch("/permission-requests/:id/reject", async (req, res) => {
  console.log("✅ REJECT PERMISSION REQUEST HIT! ID:", req.params.id);
  
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    // Get request details BEFORE updating
    const requestDetails = await queryWithRetry(
      `SELECT pr.*, ed.employee_name 
       FROM permission_requests pr
       LEFT JOIN employees_details ed ON pr.employee_id = ed.employee_id
       WHERE pr.id = ?`,
      [id]
    );

    if (!requestDetails || requestDetails.length === 0) {
      return res.status(404).json({ success: false, error: "Request not found" });
    }

    const request = requestDetails[0];

    // Update status
    await queryWithRetry(
      `UPDATE permission_requests 
       SET status = 'rejected', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id]
    );

    console.log("✅ Permission request rejected in database");

    // Send Socket.IO notification
    const io = global.io;
    const connectedUsers = global.connectedUsers;
    const targetEmployeeId = request.employee_id;

    if (io && connectedUsers && connectedUsers.has(targetEmployeeId)) {
      const socketId = connectedUsers.get(targetEmployeeId);
      
      io.to(socketId).emit("request-rejected", {
        type: "permission",
        requestId: id,
        permissionDate: request.permission_date,
        fromTime: request.from_time,
        toTime: request.to_time,
        duration: request.duration_minutes,
        rejectedBy: approvedBy,
        timestamp: new Date().toISOString(),
      });

      console.log(`🔔 Permission rejection sent to ${targetEmployeeId}`);
    }

    res.json({
      success: true,
      message: "Permission request rejected successfully",
      notificationSent: connectedUsers && connectedUsers.has(request.employee_id),
    });
  } catch (err) {
    console.error("❌ Reject permission error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to reject permission request",
      details: err.message 
    });
  }
});

// ========== GET ALL EMPLOYEES ==========
router.get("/employees", async (req, res) => {
  console.log("✅ GET EMPLOYEES HIT!");
  try {
    const query = `
      SELECT 
        employee_id, 
        employee_name, 
        designation, 
        email_official, 
        phone_official, 
        working_status, 
        password,
        profile_url
      FROM employees_details 
      ORDER BY employee_name ASC
    `;
    const results = await queryWithRetry(query);
    console.log(`✅ Found ${results.length} employees`);
    res.json({ success: true, employees: results });
  } catch (err) {
    console.error("Get employees error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch employees" });
  }
});

// ========== TEST ROUTE ==========
router.get("/test", (req, res) => {
  console.log("✅ HR TEST ROUTE WORKS!");
  res.json({ success: true, message: "HR route is working!" });
});

module.exports = router;
console.log("✅ HR Route EXPORTED!");
