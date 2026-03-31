const express = require("express");
const router = express.Router();
const { getConnectionWithRetry } = require("../../dataBase/connection");

// Helper to convert 12h time string to MySQL TIME format
const parseTimeString = (timeStr) => {
  const [time, ampm] = timeStr.split(" ");
  let [hours, minutes, seconds] = time.split(":").map(Number);
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

// ✅ Format duration in human-readable format
const formatDuration = (morningIn, morningOut, afternoonIn, afternoonOut) => {
  let totalSeconds = 0;

  // Calculate total seconds
  if (morningIn && morningOut) {
    const [h1, m1, s1] = morningIn.split(":").map(Number);
    const [h2, m2, s2] = morningOut.split(":").map(Number);
    totalSeconds += h2 * 3600 + m2 * 60 + s2 - (h1 * 3600 + m1 * 60 + s1);
  }

  if (afternoonIn && afternoonOut) {
    const [h1, m1, s1] = afternoonIn.split(":").map(Number);
    const [h2, m2, s2] = afternoonOut.split(":").map(Number);
    totalSeconds += h2 * 3600 + m2 * 60 + s2 - (h1 * 3600 + m1 * 60 + s1);
  }

  // Handle zero or negative time
  if (totalSeconds <= 0) {
    return "0 seconds";
  }

  // Convert to hours, minutes, seconds
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // Smart formatting
  if (hours >= 1) {
    if (minutes > 0) {
      return `${hours} hour${hours !== 1 ? "s" : ""} ${minutes} minute${minutes !== 1 ? "s" : ""}`;
    } else {
      return `${hours} hour${hours !== 1 ? "s" : ""}`;
    }
  } else if (minutes >= 1) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  } else {
    return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }
};

// ✅ Determine status based on completion
const calculateStatus = (morningIn, morningOut, afternoonIn, afternoonOut) => {
  const allComplete = morningIn && morningOut && afternoonIn && afternoonOut;
  const anyPresent = morningIn || morningOut || afternoonIn || afternoonOut;

  if (allComplete) return "COMPLETE";
  if (anyPresent) return "PARTIAL";
  return "INCOMPLETE";
};

// GET - Fetch attendance
router.get("/", async (req, res) => {
  let connection;
  try {
    const { employee_id, date } = req.query;

    if (!employee_id || !date) {
      return res
        .status(400)
        .json({ status: false, message: "Missing employee_id or date" });
    }

    connection = await getConnectionWithRetry();

    const [rows] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, date],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    res.json({
      status: true,
      data: rows[0] || null,
    });
  } catch (error) {
    console.error("GET attendance error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ POST - Record attendance with TIME FROM FRONTEND
router.post("/", async (req, res) => {
  let connection;
  try {
    const { employee_id, employee_name, login_date, action, time } = req.body;

    if (!employee_id || !employee_name || !login_date || !action) {
      return res
        .status(400)
        .json({ status: false, message: "Missing required fields" });
    }

    if (!time) {
      return res
        .status(400)
        .json({ status: false, message: "Time is required from frontend" });
    }

    const validActions = [
      "morning_in",
      "morning_out",
      "afternoon_in",
      "afternoon_out",
    ];
    if (!validActions.includes(action)) {
      return res.status(400).json({ status: false, message: "Invalid action" });
    }

    // ✅ USE TIME FROM FRONTEND (already synced with PHP server)
    const timeValue = parseTimeString(time);

    connection = await getConnectionWithRetry();

    // Check if record exists
    const [existing] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, login_date],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    // Update or Insert with time from frontend
    if (existing.length > 0) {
      await new Promise((resolve, reject) => {
        connection.query(
          `UPDATE attendance SET ${action} = ? WHERE employee_id = ? AND login_date = ?`,
          [timeValue, employee_id, login_date],
          (err) => (err ? reject(err) : resolve()),
        );
      });

      console.log(
        `Updated ${action} for ${employee_id} on ${login_date} with time ${time}`,
      );
    } else {
      await new Promise((resolve, reject) => {
        connection.query(
          `INSERT INTO attendance (employee_id, employee_name, login_date, ${action}) VALUES (?, ?, ?, ?)`,
          [employee_id, employee_name, login_date, timeValue],
          (err) => (err ? reject(err) : resolve()),
        );
      });

      console.log(
        `Inserted new record with ${action} for ${employee_id} on ${login_date} with time ${time}`,
      );
    }

    // Fetch the record to calculate total_hours
    const [currentRecord] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT morning_in, morning_out, afternoon_in, afternoon_out FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, login_date],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    if (!currentRecord[0]) {
      throw new Error("Record not found after insert/update");
    }

    const record = currentRecord[0];

    // Calculate total_hours (formatted string)
    const totalHours = formatDuration(
      record.morning_in,
      record.morning_out,
      record.afternoon_in,
      record.afternoon_out,
    );

    // Calculate status
    const status = calculateStatus(
      record.morning_in,
      record.morning_out,
      record.afternoon_in,
      record.afternoon_out,
    );

    console.log(`Calculated total_hours: ${totalHours}, status: ${status}`);

    // Update with calculated values
    await new Promise((resolve, reject) => {
      connection.query(
        `UPDATE attendance SET total_hours = ?, status = ? WHERE employee_id = ? AND login_date = ?`,
        [totalHours, status, employee_id, login_date],
        (err) => {
          if (err) {
            console.error("Error updating total_hours:", err);
            reject(err);
          } else {
            console.log(`Successfully updated total_hours to: ${totalHours}`);
            resolve();
          }
        },
      );
    });

    // Fetch final record to return
    const [finalRecord] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, login_date],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    console.log("Final record:", finalRecord[0]);

    res.json({
      status: true,
      message: `${action.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())} recorded at ${time}`,
      recordedTime: time,
      data: finalRecord[0],
    });
  } catch (error) {
    console.error("POST attendance error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ Recalculate all existing records
router.post("/recalculate-all", async (req, res) => {
  let connection;
  try {
    connection = await getConnectionWithRetry();

    const [records] = await new Promise((resolve, reject) => {
      connection.query(`SELECT * FROM attendance`, (err, results) =>
        err ? reject(err) : resolve([results]),
      );
    });

    let count = 0;
    let errors = 0;

    for (const record of records) {
      try {
        const totalHours = formatDuration(
          record.morning_in,
          record.morning_out,
          record.afternoon_in,
          record.afternoon_out,
        );

        const status = calculateStatus(
          record.morning_in,
          record.morning_out,
          record.afternoon_in,
          record.afternoon_out,
        );

        await new Promise((resolve, reject) => {
          connection.query(
            `UPDATE attendance SET total_hours = ?, status = ? WHERE id = ?`,
            [totalHours, status, record.id],
            (err) => (err ? reject(err) : resolve()),
          );
        });

        count++;
        console.log(`Recalculated record ${record.id}: ${totalHours}`);
      } catch (err) {
        errors++;
        console.error(`Error recalculating record ${record.id}:`, err);
      }
    }

    res.json({
      status: true,
      message: `Successfully recalculated ${count} attendance records${errors > 0 ? `, ${errors} errors` : ""}`,
      count: count,
      errors: errors,
    });
  } catch (error) {
    console.error("Recalculate error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// ==================== MISSED ATTENDANCE ROUTES ====================

// POST - Submit missed attendance request
router.post("/missed-attendance", async (req, res) => {
  let connection;
  try {
    const {
      employee_id,
      employee_name,
      request_date,
      request_time,
      attendance_type,
      action,
      reason,
    } = req.body;

    // Validation
    if (
      !employee_id ||
      !employee_name ||
      !request_date ||
      !request_time ||
      !attendance_type ||
      !action ||
      !reason
    ) {
      return res
        .status(400)
        .json({ status: false, message: "Missing required fields" });
    }

    // Convert 12h time to 24h format if needed
    const timeValue =
      request_time.includes("AM") || request_time.includes("PM")
        ? parseTimeString(request_time)
        : request_time;

    connection = await getConnectionWithRetry();

    // Check for duplicate request
    const [existing] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT id FROM missed_attendance_requests 
         WHERE employee_id = ? AND request_date = ? AND attendance_type = ? AND action = ? AND status = 'pending'`,
        [employee_id, request_date, attendance_type, action],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    if (existing.length > 0) {
      return res.status(400).json({
        status: false,
        message: "A pending request already exists for this date and action",
      });
    }

    // Insert missed attendance request
    const result = await new Promise((resolve, reject) => {
      connection.query(
        `INSERT INTO missed_attendance_requests 
         (employee_id, employee_name, request_date, request_time, attendance_type, action, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          employee_id,
          employee_name,
          request_date,
          timeValue,
          attendance_type,
          action,
          reason,
        ],
        (err, result) => (err ? reject(err) : resolve(result)),
      );
    });

    console.log(`✅ Missed attendance request created: ID ${result.insertId}`);

    // ========== SEND NOTIFICATION TO PROJECT HEADS ==========
    const io = global.io;
    const connectedUsers = global.connectedUsers;

    // Get Project Heads
    const [projectHeads] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT employee_id, employee_name FROM employees_details 
         WHERE designation = 'Project Head' AND working_status = 'Active'`,
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    // Prepare notification data
    const notificationData = {
      id: `missed_attendance_${result.insertId}_${Date.now()}`,
      title: "⏰ Missed Attendance Request",
      type: "missed_attendance",
      requestType: "missed_attendance_request",
      status: "pending",
      data: {
        requestId: result.insertId,
        employee_id: employee_id,
        employee_name: employee_name,
        requestDate: request_date,
        requestTime: timeValue,
        attendanceType: attendance_type,
        action: action,
        reason: reason,
        type: "missed_attendance",
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    // Send notifications to Project Heads
    let notifiedCount = 0;
    for (const head of projectHeads) {
      const socketId = connectedUsers?.get(head.employee_id);

      if (io && socketId) {
        io.to(socketId).emit("new-request-notification", notificationData);
        notifiedCount++;
      }

      // Save notification to database
      try {
        await new Promise((resolve, reject) => {
          connection.query(
            `INSERT INTO user_notifications 
             (employee_id, notification_id, notification_data, is_read, created_at)
             VALUES (?, ?, ?, 0, NOW())
             ON DUPLICATE KEY UPDATE notification_data = VALUES(notification_data)`,
            [
              head.employee_id,
              notificationData.id,
              JSON.stringify(notificationData),
            ],
            (err) => (err ? reject(err) : resolve()),
          );
        });
      } catch (e) {
        console.error(
          `Failed to save notification for ${head.employee_id}:`,
          e,
        );
      }
    }

    console.log(`📢 Notified ${notifiedCount} Project Heads`);

    res.json({
      status: true,
      message: "Missed attendance request submitted successfully",
      requestId: result.insertId,
      notified_count: notifiedCount,
    });
  } catch (error) {
    console.error("POST missed-attendance error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET - Fetch missed attendance requests (for Project Head)
router.get("/missed-attendance", async (req, res) => {
  let connection;
  try {
    const { status, employee_id } = req.query;

    connection = await getConnectionWithRetry();

    let query = `SELECT * FROM missed_attendance_requests`;
    const params = [];
    const conditions = [];

    if (status) {
      conditions.push(`status = ?`);
      params.push(status);
    }

    if (employee_id) {
      conditions.push(`employee_id = ?`);
      params.push(employee_id);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC`;

    const [rows] = await new Promise((resolve, reject) => {
      connection.query(query, params, (err, results) =>
        err ? reject(err) : resolve([results]),
      );
    });

    res.json({ status: true, data: rows });
  } catch (error) {
    console.error("GET missed-attendance error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// PATCH - Approve missed attendance request
router.patch("/missed-attendance/:id/approve", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { reviewed_by } = req.body;

    connection = await getConnectionWithRetry();

    // Get the request details
    const [requests] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM missed_attendance_requests WHERE id = ? AND status = 'pending'`,
        [id],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    if (requests.length === 0) {
      return res
        .status(404)
        .json({
          status: false,
          message: "Request not found or already processed",
        });
    }

    const request = requests[0];

    // Update request status
    await new Promise((resolve, reject) => {
      connection.query(
        `UPDATE missed_attendance_requests 
         SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() 
         WHERE id = ?`,
        [reviewed_by, id],
        (err) => (err ? reject(err) : resolve()),
      );
    });

    // Format action field for attendance table
    const actionField = `${request.attendance_type.toLowerCase()}_${request.action.toLowerCase()}`;

    // Check if attendance record exists for that date
    const [existingAttendance] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [request.employee_id, request.request_date],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    if (existingAttendance.length > 0) {
      // Update existing record
      await new Promise((resolve, reject) => {
        connection.query(
          `UPDATE attendance SET ${actionField} = ? WHERE employee_id = ? AND login_date = ?`,
          [request.request_time, request.employee_id, request.request_date],
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } else {
      // Create new record
      await new Promise((resolve, reject) => {
        connection.query(
          `INSERT INTO attendance (employee_id, employee_name, login_date, ${actionField}) 
           VALUES (?, ?, ?, ?)`,
          [
            request.employee_id,
            request.employee_name,
            request.request_date,
            request.request_time,
          ],
          (err) => (err ? reject(err) : resolve()),
        );
      });
    }

    // Recalculate total_hours and status
    const [currentRecord] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT morning_in, morning_out, afternoon_in, afternoon_out 
         FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [request.employee_id, request.request_date],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    if (currentRecord.length > 0) {
      const record = currentRecord[0];
      const totalHours = formatDuration(
        record.morning_in,
        record.morning_out,
        record.afternoon_in,
        record.afternoon_out,
      );
      const status = calculateStatus(
        record.morning_in,
        record.morning_out,
        record.afternoon_in,
        record.afternoon_out,
      );

      await new Promise((resolve, reject) => {
        connection.query(
          `UPDATE attendance SET total_hours = ?, status = ? 
           WHERE employee_id = ? AND login_date = ?`,
          [totalHours, status, request.employee_id, request.request_date],
          (err) => (err ? reject(err) : resolve()),
        );
      });
    }

    console.log(`✅ Missed attendance approved: ID ${id}`);

    // ========== NOTIFY THE EMPLOYEE ==========
    const io = global.io;
    const connectedUsers = global.connectedUsers;

    const notificationData = {
      id: `missed_attendance_approved_${id}_${Date.now()}`,
      title: "✅ Missed Attendance Approved",
      type: "missed_attendance",
      status: "approved",
      data: {
        requestId: parseInt(id),
        employee_id: request.employee_id,
        employee_name: request.employee_name,
        requestDate: request.request_date,
        requestTime: request.request_time,
        attendanceType: request.attendance_type,
        action: request.action,
        approvedBy: reviewed_by,
        type: "missed_attendance",
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    const socketId = connectedUsers?.get(request.employee_id);
    if (io && socketId) {
      io.to(socketId).emit("request-approved", notificationData);
    }

    res.json({
      status: true,
      message: "Missed attendance request approved and attendance updated",
    });
  } catch (error) {
    console.error("PATCH approve error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// PATCH - Reject missed attendance request
router.patch("/missed-attendance/:id/reject", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { reviewed_by, rejection_reason } = req.body;

    connection = await getConnectionWithRetry();

    // Get the request details
    const [requests] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM missed_attendance_requests WHERE id = ? AND status = 'pending'`,
        [id],
        (err, results) => (err ? reject(err) : resolve([results])),
      );
    });

    if (requests.length === 0) {
      return res
        .status(404)
        .json({
          status: false,
          message: "Request not found or already processed",
        });
    }

    const request = requests[0];

    // Update request status
    await new Promise((resolve, reject) => {
      connection.query(
        `UPDATE missed_attendance_requests 
         SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW() 
         WHERE id = ?`,
        [reviewed_by, id],
        (err) => (err ? reject(err) : resolve()),
      );
    });

    console.log(`❌ Missed attendance rejected: ID ${id}`);

    // ========== NOTIFY THE EMPLOYEE ==========
    const io = global.io;
    const connectedUsers = global.connectedUsers;

    const notificationData = {
      id: `missed_attendance_rejected_${id}_${Date.now()}`,
      title: "❌ Missed Attendance Rejected",
      type: "missed_attendance",
      status: "rejected",
      data: {
        requestId: parseInt(id),
        employee_id: request.employee_id,
        employee_name: request.employee_name,
        requestDate: request.request_date,
        requestTime: request.request_time,
        attendanceType: request.attendance_type,
        action: request.action,
        rejectedBy: reviewed_by,
        rejectionReason: rejection_reason || "No reason provided",
        type: "missed_attendance",
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    const socketId = connectedUsers?.get(request.employee_id);
    if (io && socketId) {
      io.to(socketId).emit("request-rejected", notificationData);
    }

    res.json({
      status: true,
      message: "Missed attendance request rejected",
    });
  } catch (error) {
    console.error("PATCH reject error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
