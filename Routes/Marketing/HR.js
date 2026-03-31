const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ========== GET ALL LEAVE REQUESTS WITH APPROVAL STATUS ==========
router.get("/leave-requests", async (req, res) => {
  try {
    const formatDateLocal = (date) => {
      if (!date) return null;
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const query = `
      SELECT 
        lr.id,
        lr.employee_id,
        lr.leave_type,
        lr.from_date,
        lr.to_date,
        lr.number_of_days,
        lr.duration_type,         
        lr.reason,
        lr.status,
        lr.team_head_status,
        lr.team_head_remark,
        lr.team_head_updated_by,
        lr.team_head_updated_at,
        lr.management_status,
        lr.management_remark,
        lr.management_updated_by,
        lr.management_updated_at,
        lr.created_at,
        lr.updated_at,
        ed.employee_name,
        ed.profile_url
      FROM leave_requests lr
      LEFT JOIN employees_details ed ON lr.employee_id = ed.employee_id
      ORDER BY 
        CASE 
          WHEN lr.management_status IS NULL AND lr.team_head_status IS NULL THEN 0
          WHEN lr.management_status IS NULL AND lr.team_head_status IS NOT NULL THEN 1
          WHEN lr.management_status IS NOT NULL THEN 2
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
      from_date: formatDateLocal(row.from_date),
      to_date: formatDateLocal(row.to_date),
      number_of_days: row.number_of_days,
      duration_type: row.duration_type || null,
      reason: row.reason,
      status: row.status,
      team_head_status: row.team_head_status,
      team_head_remark: row.team_head_remark,
      team_head_updated_by: row.team_head_updated_by,
      team_head_updated_at: row.team_head_updated_at,
      management_status: row.management_status,
      management_remark: row.management_remark,
      management_updated_by: row.management_updated_by,
      management_updated_at: row.management_updated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json({ success: true, requests: formattedResults });
  } catch (err) {
    console.error("Get leave requests error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch leave requests" });
  }
});

// ========== UPDATE LEAVE REQUEST WITH APPROVAL (NEW ENDPOINT) ==========
// In hr.js - PATCH /hr/leave-requests/:id/update-approval
router.patch("/leave-requests/:id/update-approval", async (req, res) => {

  try {
    const { id } = req.params;
    const { action, remark, updated_by, designation } = req.body;

    if (!action || !remark || !updated_by || !designation) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const requestDetails = await queryWithRetry(
      `SELECT * FROM leave_requests WHERE id = ?`,
      [id],
    );

    if (!requestDetails || requestDetails.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Request not found",
      });
    }

    const request = requestDetails[0];
    let updateQuery;
    let updateParams;

    if (designation === "Project Head") {
      if (request.team_head_status && request.team_head_status !== "hold") {
        return res.status(400).json({
          success: false,
          error: "Can only update requests in 'Hold' status",
        });
      }

      updateQuery = `
        UPDATE leave_requests 
        SET team_head_status = ?,
            team_head_remark = ?,
            team_head_updated_by = ?,
            team_head_updated_at = CURRENT_TIMESTAMP,
            status = ?
        WHERE id = ?
      `;

      const overallStatus = action === "hold" ? "pending" : "pending";
      updateParams = [action, remark, updated_by, overallStatus, id];
    } else if (designation === "Admin") {
      updateQuery = `
        UPDATE leave_requests 
        SET management_status = ?,
            management_remark = ?,
            management_updated_by = ?,
            management_updated_at = CURRENT_TIMESTAMP,
            status = ?
        WHERE id = ?
      `;

      const finalStatus =
        action === "approved"
          ? "approved"
          : action === "rejected"
            ? "rejected"
            : "pending";
      updateParams = [action, remark, updated_by, finalStatus, id];
    } else {
      return res.status(403).json({
        success: false,
        error: "Unauthorized: Invalid designation",
      });
    }

    await queryWithRetry(updateQuery, updateParams);


    // ========== SEND SOCKET.IO NOTIFICATION ==========
    const io = global.io;
    const connectedUsers = global.connectedUsers;
    const targetEmployeeId = request.employee_id;

    // Prepare notification data
    const notificationData = {
      type: "leave",
      requestType: "status_update",
      requestId: id,
      action: action, // approved / rejected / hold
      updatedBy: updated_by,
      designation: designation,
      remark: remark,
      timestamp: new Date().toISOString(),
      data: {
        requestId: id,
        action: action,
        updatedBy: updated_by,
        designation: designation,
        remark: remark,
        // Include request details for display
        leaveType: request.leave_type,
        fromDate: request.from_date,
        toDate: request.to_date,
        numberOfDays: request.number_of_days,
        reason: request.reason,
        type: "leave",
      },
    };

    let notificationSent = false;

    if (io && connectedUsers && connectedUsers.has(targetEmployeeId)) {
      const socketId = connectedUsers.get(targetEmployeeId);

      try {
        io.to(socketId).emit("request-status-updated", notificationData);
        notificationSent = true;
      } catch (error) {
        console.error(`❌ Failed to send socket notification:`, error);
      }
    } else {
    }

    // ========== SAVE NOTIFICATION TO DATABASE ==========
    try {
      const dbNotification = {
        id: `leave_${id}_${action}`,
        title:
          action === "approved"
            ? "✅ Request Approved!"
            : action === "rejected"
              ? "❌ Request Rejected"
              : "⏸️ Request On Hold",
        type: "leave",
        status: action,
        data: notificationData,
        timestamp: new Date().toISOString(),
        read: false,
      };

      await queryWithRetry(
        `INSERT INTO user_notifications 
         (employee_id, notification_id, notification_data, is_read, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         notification_data = VALUES(notification_data)`,
        [
          targetEmployeeId,
          dbNotification.id,
          JSON.stringify(dbNotification),
          0,
          dbNotification.timestamp,
        ],
      );
    } catch (err) {
      console.error(`❌ Failed to save notification to DB:`, err);
    }

    res.json({
      success: true,
      message: `Leave request ${action} by ${designation}`,
      notificationSent: notificationSent,
    });
  } catch (err) {
    console.error("❌ Update approval error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update leave request",
      details: err.message,
    });
  }
});

// ========== GET ALL PERMISSION REQUESTS ==========
router.get("/permission-requests", async (req, res) => {
  try {
    const formatDateLocal = (date) => {
      if (!date) return null;
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

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
      permission_date: formatDateLocal(row.permission_date),
      from_time: row.from_time ? row.from_time.toString().slice(0, 5) : null,
      to_time: row.to_time ? row.to_time.toString().slice(0, 5) : null,
      duration_minutes: row.duration_minutes,
      reason: row.reason,
      status: row.status,
      approved_by: row.approved_by || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json({ success: true, requests: formattedResults });
  } catch (err) {
    console.error("Get permission requests error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch permission requests" });
  }
});

// ========== LEGACY ENDPOINTS (Keep for backward compatibility) ==========

router.patch("/leave-requests/:id/approve", async (req, res) => {
  res.status(400).json({
    success: false,
    error: "Please use the Update button for approval workflow",
  });
});

router.patch("/leave-requests/:id/reject", async (req, res) => {
  res.status(400).json({
    success: false,
    error: "Please use the Update button for approval workflow",
  });
});

// ========== PERMISSION REQUEST ENDPOINTS (OLD SYSTEM) ==========
router.patch("/permission-requests/:id/approve", async (req, res) => {

  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    const requestDetails = await queryWithRetry(
      `SELECT pr.*, ed.employee_name 
       FROM permission_requests pr
       LEFT JOIN employees_details ed ON pr.employee_id = ed.employee_id
       WHERE pr.id = ?`,
      [id],
    );

    if (!requestDetails || requestDetails.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Request not found" });
    }

    const request = requestDetails[0];

    await queryWithRetry(
      `UPDATE permission_requests 
       SET status = 'approved', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id],
    );


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

    }

    res.json({
      success: true,
      message: "Permission request approved successfully",
      notificationSent:
        connectedUsers && connectedUsers.has(request.employee_id),
    });
  } catch (err) {
    console.error("❌ Approve permission error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to approve permission request",
      details: err.message,
    });
  }
});

router.patch("/permission-requests/:id/reject", async (req, res) => {

  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    const requestDetails = await queryWithRetry(
      `SELECT pr.*, ed.employee_name 
       FROM permission_requests pr
       LEFT JOIN employees_details ed ON pr.employee_id = ed.employee_id
       WHERE pr.id = ?`,
      [id],
    );

    if (!requestDetails || requestDetails.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Request not found" });
    }

    const request = requestDetails[0];

    await queryWithRetry(
      `UPDATE permission_requests 
       SET status = 'rejected', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id],
    );


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

    }

    res.json({
      success: true,
      message: "Permission request rejected successfully",
      notificationSent:
        connectedUsers && connectedUsers.has(request.employee_id),
    });
  } catch (err) {
    console.error("❌ Reject permission error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to reject permission request",
      details: err.message,
    });
  }
});

// ========== DELETE ENDPOINTS ==========
router.delete("/leave-requests/:id", async (req, res) => {

  try {
    const { id } = req.params;

    const checkQuery = `SELECT id FROM leave_requests WHERE id = ?`;
    const existingRequest = await queryWithRetry(checkQuery, [id]);

    if (!existingRequest || existingRequest.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Leave request not found",
      });
    }


    await queryWithRetry(`DELETE FROM leave_requests WHERE id = ?`, [id]);


    res.json({
      success: true,
      message: "Leave request deleted successfully",
    });
  } catch (err) {
    console.error("❌ Delete leave request error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete leave request",
      details: err.message,
    });
  }
});

router.delete("/permission-requests/:id", async (req, res) => {

  try {
    const { id } = req.params;

    const checkQuery = `SELECT id FROM permission_requests WHERE id = ?`;
    const existingRequest = await queryWithRetry(checkQuery, [id]);

    if (!existingRequest || existingRequest.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Permission request not found",
      });
    }


    await queryWithRetry(`DELETE FROM permission_requests WHERE id = ?`, [id]);


    res.json({
      success: true,
      message: "Permission request deleted successfully",
    });
  } catch (err) {
    console.error("❌ Delete permission request error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete permission request",
      details: err.message,
    });
  }
});

// ========== GET ALL EMPLOYEES ==========
router.get("/employees", async (req, res) => {
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
      WHERE working_status = 'Active'
      ORDER BY employee_name ASC
    `;
    const results = await queryWithRetry(query);
    res.json({ success: true, employees: results });
  } catch (err) {
    console.error("Get employees error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch employees" });
  }
});

// ========== TEST ROUTE ==========
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "HR route with approval system is working!",
  });
});

module.exports = router;
