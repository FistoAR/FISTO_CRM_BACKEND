console.log("🚀 LOADING EmployeeRequests route...");

const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ========== LEAVE REQUESTS ==========
router.post("/leave-requests", async (req, res) => {
  console.log("✅ LEAVE REQUEST HIT!");
  try {
    const userData = JSON.parse(req.headers['x-user-data'] || '{}');
    const employee_id = userData.userName || 'FST001';
    const { leave_type, from_date, to_date, number_of_days, reason } = req.body;

    if (!leave_type || !from_date || !number_of_days || !reason?.trim()) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await queryWithRetry(
      `INSERT INTO leave_requests 
       (employee_id, leave_type, from_date, to_date, number_of_days, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [employee_id, leave_type, from_date, to_date || null, parseInt(number_of_days), reason.trim()]
    );

    res.json({
      success: true,
      message: "Leave request created successfully",
      leaveRequestId: result.insertId,
      employee_id: employee_id,
    });
  } catch (err) {
    console.error("Leave request error:", err);
    res.status(500).json({ error: "Failed to create leave request" });
  }
});

// ========== PERMISSION REQUESTS ==========
router.post("/permission-requests", async (req, res) => {
  console.log("✅ PERMISSION REQUEST HIT!");
  try {
    const userData = JSON.parse(req.headers['x-user-data'] || '{}');
    const employee_id = userData.userName || 'FST001';
    const { permission_date, from_time, to_time, duration_minutes, reason } = req.body;

    if (!permission_date || !from_time || !to_time || !reason?.trim()) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await queryWithRetry(
      `INSERT INTO permission_requests 
       (employee_id, permission_date, from_time, to_time, duration_minutes, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [employee_id, permission_date, from_time, to_time, parseFloat(duration_minutes), reason.trim()]
    );

    res.json({
      success: true,
      message: "Permission request created successfully",
      permissionRequestId: result.insertId,
      employee_id: employee_id,
    });
  } catch (err) {
    console.error("Permission request error:", err);
    res.status(500).json({ error: "Failed to create permission request" });
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
    console.error("Get employees error:", err);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

// ========== MEETING REQUESTS - POST ==========
router.post("/meeting-requests", async (req, res) => {
  console.log("✅ MEETING REQUEST HIT!");
  try {
    const userData = JSON.parse(req.headers['x-user-data'] || '{}');
    const employee_id = userData.userName || 'FST001';
    
    const { 
      meeting_title, 
      meeting_date, 
      from_time, 
      to_time, 
      duration_minutes, 
      attendees, 
      description 
    } = req.body;

    console.log("Meeting data:", { employee_id, meeting_title, attendees });

    if (!meeting_title || !meeting_date || !from_time || !to_time || !attendees?.length) {
      return res.status(400).json({ error: "Missing required fields" });
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
        description || null
      ]
    );

    res.json({
      success: true,
      message: "Meeting scheduled successfully",
      meetingId: result.insertId,
      employee_id: employee_id,
      attendees_count: attendees.length
    });
  } catch (err) {
    console.error("Meeting request error:", err);
    res.status(500).json({ error: "Failed to schedule meeting" });
  }
});

// ========== MEETING REQUESTS - GET ==========
router.get("/meeting-requests", async (req, res) => {
  console.log("✅ GET MEETINGS HIT!");
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
    
    const meetings = results.map(meeting => ({
      ...meeting,
      attendees: typeof meeting.attendees === 'string' 
        ? JSON.parse(meeting.attendees) 
        : meeting.attendees
    }));

    res.json({ success: true, meetings });
  } catch (err) {
    console.error("Get meetings error:", err);
    res.status(500).json({ error: "Failed to fetch meetings" });
  }
});

// ========== TEST ROUTE ==========
router.get("/test", (req, res) => {
  console.log("✅ TEST ROUTE WORKS!");
  res.json({ success: true, message: "Employee Requests route LOADED!" });
});

module.exports = router;
console.log("✅ EmployeeRequests EXPORTED!");
