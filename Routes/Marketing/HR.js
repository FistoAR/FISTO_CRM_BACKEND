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
      approved_by: row.approved_by || null,  // ADD THIS
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
      approved_by: row.approved_by || null,  // ADD THIS
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


// ========== APPROVE LEAVE REQUEST ==========
router.patch("/leave-requests/:id/approve", async (req, res) => {
  console.log("✅ APPROVE LEAVE REQUEST HIT!");
  try {
    const { id } = req.params;
    const { approvedBy } = req.body; 

    await queryWithRetry(
      `UPDATE leave_requests 
       SET status = 'approved', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id]
    );

    res.json({ success: true, message: "Leave request approved successfully" });
  } catch (err) {
    console.error("Approve leave request error:", err);
    res.status(500).json({ success: false, error: "Failed to approve leave request" });
  }
});


// ========== REJECT LEAVE REQUEST ==========
router.patch("/leave-requests/:id/reject", async (req, res) => {
  console.log("✅ REJECT LEAVE REQUEST HIT!");
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    await queryWithRetry(
      `UPDATE leave_requests 
       SET status = 'rejected', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id]
    );

    res.json({ success: true, message: "Leave request rejected successfully" });
  } catch (err) {
    console.error("Reject leave request error:", err);
    res.status(500).json({ success: false, error: "Failed to reject leave request" });
  }
});
;

// ========== APPROVE PERMISSION REQUEST ==========
router.patch("/permission-requests/:id/approve", async (req, res) => {
  console.log("✅ APPROVE PERMISSION REQUEST HIT!");
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    await queryWithRetry(
      `UPDATE permission_requests 
       SET status = 'approved', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id]
    );

    res.json({ success: true, message: "Permission request approved successfully" });
  } catch (err) {
    console.error("Approve permission request error:", err);
    res.status(500).json({ success: false, error: "Failed to approve permission request" });
  }
});


// ========== REJECT PERMISSION REQUEST ==========
router.patch("/permission-requests/:id/reject", async (req, res) => {
  console.log("✅ REJECT PERMISSION REQUEST HIT!");
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;

    await queryWithRetry(
      `UPDATE permission_requests 
       SET status = 'rejected', 
           approved_by = ?, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approvedBy || null, id]
    );

    res.json({ success: true, message: "Permission request rejected successfully" });
  } catch (err) {
    console.error("Reject permission request error:", err);
    res.status(500).json({ success: false, error: "Failed to reject permission request" });
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
