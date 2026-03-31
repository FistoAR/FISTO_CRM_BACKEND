const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ========== HELPER FUNCTION: GET EMPLOYEES BY DESIGNATION ==========
async function getEmployeesByDesignation(designations) {
  try {
    const placeholders = designations.map(() => "?").join(",");
    const query = `
      SELECT employee_id, employee_name, designation 
      FROM employees_details 
      WHERE designation IN (${placeholders}) 
      AND working_status = 'Active'
    `;

    const results = await queryWithRetry(query, designations);

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
        io.to(socketId).emit("new-request-notification", notificationData);
        notifiedCount++;
      } catch (error) {
        console.error(
          `❌ Failed to send notification to ${employeeId}:`,
          error,
        );
      }
    } else {

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
          notificationData.timestamp,
        ],
      );
    } catch (err) {
      console.error(
        `❌ Failed to save notification to DB for ${employeeId}:`,
        err,
      );
    }
  }

  return notifiedCount;
}

// ========== LEAVE REQUESTS ==========
router.post("/leave-requests", async (req, res) => {
  try {
    const userData = JSON.parse(req.headers["x-user-data"] || "{}");
    const employee_id = userData.userName || "FST001";
    const employee_name = userData.employeeName || employee_id;
    const {
      leave_type,
      from_date,
      to_date,
      number_of_days,
      reason,
      duration_type,
    } = req.body;

    if (!leave_type || !from_date || !number_of_days || !reason?.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    // Insert leave request
    const result = await queryWithRetry(
      `INSERT INTO leave_requests 
   (employee_id, leave_type, from_date, to_date, number_of_days, duration_type, reason, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        employee_id,
        leave_type,
        from_date,
        to_date || null,
        parseFloat(number_of_days),
        duration_type || null,
        reason.trim(),
      ],
    );


    // Get employees with specific designations
    const targetEmployees = await getEmployeesByDesignation([
      "Admin",
      "Digital Marketing & HR",
      "Project Head",
    ]);

    if (targetEmployees.length === 0) {
      console.warn("⚠️ No employees found with required designations");
    }

    // Prepare notification data
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
        type: "leave",
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    // Send notifications
    const employeeIds = targetEmployees.map((emp) => emp.employee_id);
    const notifiedCount = await notifySpecificUsers(
      employeeIds,
      notificationData,
    );

    res.json({
      success: true,
      message: "Leave request submitted successfully",
      leaveRequestId: result.insertId,
      employee_id: employee_id,
      notified_count: notifiedCount,
      total_recipients: targetEmployees.length,
    });
  } catch (err) {
    console.error("❌ Leave request error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create leave request" });
  }
});

// ========== PERMISSION REQUESTS ==========
router.post("/permission-requests", async (req, res) => {
  try {
    const userData = JSON.parse(req.headers["x-user-data"] || "{}");
    const employee_id = userData.userName || "FST001";
    const employee_name = userData.employeeName || employee_id;
    const { permission_date, from_time, to_time, duration_minutes, reason } =
      req.body;

    if (!permission_date || !from_time || !to_time || !reason?.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    // Insert permission request
    const result = await queryWithRetry(
      `INSERT INTO permission_requests 
       (employee_id, permission_date, from_time, to_time, duration_minutes, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        employee_id,
        permission_date,
        from_time,
        to_time,
        parseFloat(duration_minutes),
        reason.trim(),
      ],
    );

    // Get employees with specific designations
    const targetEmployees = await getEmployeesByDesignation([
      "Admin",
      "Digital Marketing & HR",
      "Project Head",
    ]);

    if (targetEmployees.length === 0) {
      console.warn("⚠️ No employees found with required designations");
    }

    // Prepare notification data
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
        type: "permission",
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    // Send notifications
    const employeeIds = targetEmployees.map((emp) => emp.employee_id);
    const notifiedCount = await notifySpecificUsers(
      employeeIds,
      notificationData,
    );

    res.json({
      success: true,
      message: "Permission request submitted successfully",
      permissionRequestId: result.insertId,
      employee_id: employee_id,
      notified_count: notifiedCount,
      total_recipients: targetEmployees.length,
    });
  } catch (err) {
    console.error("❌ Permission request error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create permission request" });
  }
});

// ========== GET EMPLOYEES FOR ATTENDEES DROPDOWN ==========
router.get("/employees", async (req, res) => {
  try {
    const results = await queryWithRetry(
      `SELECT employee_id, employee_name FROM employees_details 
       WHERE working_status = 'Active' 
       ORDER BY employee_name ASC`,
    );

    res.json({
      success: true,
      employees: results.map((emp) => ({
        employee_id: emp.employee_id,
        employee_name: emp.employee_name,
      })),
    });
  } catch (err) {
    console.error("❌ Get employees error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch employees" });
  }
});

// ========== MEETING REQUESTS - POST ==========
router.post("/meeting-requests", async (req, res) => {
  try {
    const userData = JSON.parse(req.headers["x-user-data"] || "{}");
    const employee_id = userData.userName || "FST001";
    const employee_name = userData.employeeName || employee_id;

    const {
      meeting_title,
      meeting_date,
      from_time,
      to_time,
      duration_minutes,
      attendees,
      description,
    } = req.body;


    if (
      !meeting_title ||
      !meeting_date ||
      !from_time ||
      !to_time ||
      !attendees?.length
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    const attendeesJSON = JSON.stringify(attendees);

    const result = await queryWithRetry(
      `INSERT INTO meeting_requests 
       (employee_id, meeting_title, meeting_date, from_time, to_time, duration_minutes, attendees, description, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
      [
        employee_id,
        meeting_title,
        meeting_date,
        from_time,
        to_time,
        parseInt(duration_minutes) || 0,
        attendeesJSON,
        description || null,
      ],
    );


    // Prepare notification data for meeting attendees
    const notificationData = {
      id: `meeting_${result.insertId}_${Date.now()}`,
      title: "📅 New Meeting Scheduled",
      type: "meeting",
      requestType: "new_meeting",
      status: "scheduled",
      data: {
        meetingId: result.insertId,
        organizer_id: employee_id,
        organizer_name: employee_name,
        meetingTitle: meeting_title,
        meetingDate: meeting_date,
        fromTime: from_time,
        toTime: to_time,
        duration: duration_minutes,
        description: description,
        type: "meeting",
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    // Send notifications to all attendees
    const attendeeIds = attendees.map((att) => att.employee_id);
    const notifiedCount = await notifySpecificUsers(
      attendeeIds,
      notificationData,
    );

    res.json({
      success: true,
      message: "Meeting scheduled successfully",
      meetingId: result.insertId,
      employee_id: employee_id,
      attendees_count: attendees.length,
      notified_count: notifiedCount,
    });
  } catch (err) {
    console.error("❌ Meeting request error:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to schedule meeting" });
  }
});

// ========== MEETING REQUESTS - GET ==========
router.get("/meeting-requests", async (req, res) => {
  try {
    const { employee_id } = req.query;

    let query = `SELECT * FROM meeting_requests ORDER BY meeting_date DESC, from_time ASC`;
    let params = [];

    if (employee_id) {
      query = `SELECT * FROM meeting_requests 
               WHERE employee_id = ? 
               OR JSON_CONTAINS(attendees, JSON_OBJECT('employee_id', ?))
               ORDER BY meeting_date DESC, from_time ASC`;
      params = [employee_id, employee_id];
    }

    const results = await queryWithRetry(query, params);

    const meetings = results.map((meeting) => ({
      ...meeting,
      attendees:
        typeof meeting.attendees === "string"
          ? JSON.parse(meeting.attendees)
          : meeting.attendees,
    }));

    res.json({ success: true, meetings });
  } catch (err) {
    console.error("❌ Get meetings error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch meetings" });
  }
});

// ========== TEST ROUTE ==========
router.get("/test", (req, res) => {
  res.json({ success: true, message: "Employee Requests route LOADED!" });
});

module.exports = router;
