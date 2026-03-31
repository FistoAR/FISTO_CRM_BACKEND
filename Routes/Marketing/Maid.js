const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");

// =====================================================
// HELPER FUNCTIONS
// =====================================================

// Format date to YYYY-MM-DD
const formatDateKey = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Get Monday of a given week
const getWeekMonday = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

// Get all working days (Mon-Sat) in a month
const getMonthWorkingDays = (year, month) => {
  const dates = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  for (let date = new Date(firstDay); date <= lastDay; date.setDate(date.getDate() + 1)) {
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0) { // Exclude Sunday
      dates.push(formatDateKey(new Date(date)));
    }
  }
  return dates;
};

// =====================================================
// ATTENDANCE ROUTES
// =====================================================

/**
 * GET /maid/attendance
 * Fetch attendance for a date range
 * Query params: startDate, endDate (YYYY-MM-DD)
 */
router.get("/attendance", (req, res) => {
  const { startDate, endDate } = req.query;

  let query = `
    SELECT 
      id,
      DATE_FORMAT(attendance_date, '%Y-%m-%d') as date,
      TIME_FORMAT(morning_in, '%H:%i') as morningIn,
      TIME_FORMAT(morning_out, '%H:%i') as morningOut,
      TIME_FORMAT(evening_in, '%H:%i') as eveningIn,
      TIME_FORMAT(evening_out, '%H:%i') as eveningOut,
      is_leave as isLeave,
      leave_type as leaveType,
      leave_duration as leaveDuration
    FROM maid_attendance
  `;

  const params = [];

  if (startDate && endDate) {
    query += " WHERE attendance_date BETWEEN ? AND ?";
    params.push(startDate, endDate);
  } else if (startDate) {
    query += " WHERE attendance_date >= ?";
    params.push(startDate);
  } else if (endDate) {
    query += " WHERE attendance_date <= ?";
    params.push(endDate);
  }

  query += " ORDER BY attendance_date ASC";

  db.pool.query(query, params, (err, results) => {
    if (err) {
      console.error("Fetch attendance error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    // Convert to object keyed by date for frontend
    const attendanceData = {};
    results.forEach((row) => {
      attendanceData[row.date] = {
        id: row.id,
        morningIn: row.morningIn || "",
        morningOut: row.morningOut || "",
        eveningIn: row.eveningIn || "",
        eveningOut: row.eveningOut || "",
        isLeave: Boolean(row.isLeave),
        leaveType: row.leaveType || "",
        leaveDuration: row.leaveDuration || "",
      };
    });

    res.json({
      status: true,
      attendance: attendanceData,
      count: results.length,
    });
  });
});

/**
 * GET /maid/attendance/:date
 * Fetch attendance for a specific date
 */
router.get("/attendance/:date", (req, res) => {
  const { date } = req.params;

  const query = `
    SELECT 
      id,
      DATE_FORMAT(attendance_date, '%Y-%m-%d') as date,
      TIME_FORMAT(morning_in, '%H:%i') as morningIn,
      TIME_FORMAT(morning_out, '%H:%i') as morningOut,
      TIME_FORMAT(evening_in, '%H:%i') as eveningIn,
      TIME_FORMAT(evening_out, '%H:%i') as eveningOut,
      is_leave as isLeave,
      leave_type as leaveType,
      leave_duration as leaveDuration
    FROM maid_attendance
    WHERE attendance_date = ?
  `;

  db.pool.query(query, [date], (err, results) => {
    if (err) {
      console.error("Fetch attendance error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.json({
        status: true,
        attendance: null,
        message: "No attendance record found for this date",
      });
    }

    const row = results[0];
    res.json({
      status: true,
      attendance: {
        id: row.id,
        date: row.date,
        morningIn: row.morningIn || "",
        morningOut: row.morningOut || "",
        eveningIn: row.eveningIn || "",
        eveningOut: row.eveningOut || "",
        isLeave: Boolean(row.isLeave),
        leaveType: row.leaveType || "",
        leaveDuration: row.leaveDuration || "",
      },
    });
  });
});

/**
 * POST /maid/attendance
 * Create or update attendance for a date
 */
router.post("/attendance", (req, res) => {
  const {
    date,
    morningIn,
    morningOut,
    eveningIn,
    eveningOut,
    isLeave,
    leaveType,
    leaveDuration,
  } = req.body;

  if (!date) {
    return res.status(400).json({
      status: false,
      message: "Date is required",
    });
  }

  // Validate leave data
  if (isLeave && (!leaveType || !leaveDuration)) {
    return res.status(400).json({
      status: false,
      message: "Leave type and duration are required when marking leave",
    });
  }

  // Use INSERT ... ON DUPLICATE KEY UPDATE for upsert
  const query = `
    INSERT INTO maid_attendance (
      attendance_date, morning_in, morning_out, evening_in, evening_out,
      is_leave, leave_type, leave_duration
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      morning_in = VALUES(morning_in),
      morning_out = VALUES(morning_out),
      evening_in = VALUES(evening_in),
      evening_out = VALUES(evening_out),
      is_leave = VALUES(is_leave),
      leave_type = VALUES(leave_type),
      leave_duration = VALUES(leave_duration)
  `;

  const params = [
    date,
    morningIn || null,
    morningOut || null,
    eveningIn || null,
    eveningOut || null,
    isLeave || false,
    isLeave ? leaveType : null,
    isLeave ? leaveDuration : null,
  ];

  db.pool.query(query, params, (err, result) => {
    if (err) {
      console.error("Save attendance error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      message: "Attendance saved successfully",
      id: result.insertId || result.affectedRows,
    });
  });
});

/**
 * PUT /maid/attendance/:date
 * Update attendance for a specific date
 */
router.put("/attendance/:date", (req, res) => {
  const { date } = req.params;
  const {
    morningIn,
    morningOut,
    eveningIn,
    eveningOut,
    isLeave,
    leaveType,
    leaveDuration,
  } = req.body;

  const query = `
    UPDATE maid_attendance SET
      morning_in = ?,
      morning_out = ?,
      evening_in = ?,
      evening_out = ?,
      is_leave = ?,
      leave_type = ?,
      leave_duration = ?
    WHERE attendance_date = ?
  `;

  const params = [
    morningIn || null,
    morningOut || null,
    eveningIn || null,
    eveningOut || null,
    isLeave || false,
    isLeave ? leaveType : null,
    isLeave ? leaveDuration : null,
    date,
  ];

  db.pool.query(query, params, (err, result) => {
    if (err) {
      console.error("Update attendance error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Attendance record not found",
      });
    }

    res.json({
      status: true,
      message: "Attendance updated successfully",
    });
  });
});

/**
 * DELETE /maid/attendance/:date
 * Delete attendance for a specific date
 */
router.delete("/attendance/:date", (req, res) => {
  const { date } = req.params;

  const query = "DELETE FROM maid_attendance WHERE attendance_date = ?";

  db.pool.query(query, [date], (err, result) => {
    if (err) {
      console.error("Delete attendance error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Attendance record not found",
      });
    }

    res.json({
      status: true,
      message: "Attendance deleted successfully",
    });
  });
});

// =====================================================
// TASKS ROUTES
// =====================================================

/**
 * GET /maid/tasks
 * Fetch all tasks for given week keys
 * Query params: weekKeys (comma-separated) or month, year
 */
router.get("/tasks", (req, res) => {
  const { weekKeys, month, year } = req.query;

  let query = `
    SELECT 
      id,
      DATE_FORMAT(week_key, '%Y-%m-%d') as weekKey,
      task_id as taskId,
      check_index as checkIndex,
      DATE_FORMAT(completed_date, '%Y-%m-%d') as completedDate
    FROM maid_tasks
  `;

  const params = [];

  if (weekKeys) {
    const keys = weekKeys.split(",");
    query += ` WHERE week_key IN (${keys.map(() => "?").join(",")})`;
    params.push(...keys);
  } else if (month !== undefined && year) {
    // Get all weeks in the month
    const workingDays = getMonthWorkingDays(parseInt(year), parseInt(month));
    const weekKeySet = new Set();
    workingDays.forEach((day) => {
      const monday = getWeekMonday(day);
      weekKeySet.add(formatDateKey(monday));
    });
    const uniqueWeekKeys = Array.from(weekKeySet);
    
    if (uniqueWeekKeys.length > 0) {
      query += ` WHERE week_key IN (${uniqueWeekKeys.map(() => "?").join(",")})`;
      params.push(...uniqueWeekKeys);
    }
  }

  query += " ORDER BY week_key, task_id, check_index";

  db.pool.query(query, params, (err, results) => {
    if (err) {
      console.error("Fetch tasks error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    // Convert to nested object structure for frontend
    // { weekKey: { taskId: [completedDate, null, completedDate] } }
    const tasksData = {};
    results.forEach((row) => {
      if (!tasksData[row.weekKey]) {
        tasksData[row.weekKey] = {};
      }
      if (!tasksData[row.weekKey][row.taskId]) {
        tasksData[row.weekKey][row.taskId] = [];
      }
      tasksData[row.weekKey][row.taskId][row.checkIndex] = row.completedDate;
    });

    res.json({
      status: true,
      tasks: tasksData,
      count: results.length,
    });
  });
});

/**
 * POST /maid/tasks
 * Toggle a task check (add or remove)
 */
router.post("/tasks", (req, res) => {
  const { weekKey, taskId, checkIndex, completedDate } = req.body;

  if (!weekKey || !taskId || checkIndex === undefined) {
    return res.status(400).json({
      status: false,
      message: "weekKey, taskId, and checkIndex are required",
    });
  }

  if (completedDate) {
    // Add task check
    const insertQuery = `
      INSERT INTO maid_tasks (week_key, task_id, check_index, completed_date)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE completed_date = VALUES(completed_date)
    `;

    db.pool.query(insertQuery, [weekKey, taskId, checkIndex, completedDate], (err, result) => {
      if (err) {
        console.error("Add task check error:", err);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: err.message,
        });
      }

      res.json({
        status: true,
        message: "Task check added successfully",
        action: "added",
      });
    });
  } else {
    // Remove task check
    const deleteQuery = `
      DELETE FROM maid_tasks 
      WHERE week_key = ? AND task_id = ? AND check_index = ?
    `;

    db.pool.query(deleteQuery, [weekKey, taskId, checkIndex], (err, result) => {
      if (err) {
        console.error("Remove task check error:", err);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: err.message,
        });
      }

      res.json({
        status: true,
        message: "Task check removed successfully",
        action: "removed",
      });
    });
  }
});

/**
 * DELETE /maid/tasks/:weekKey/:taskId/:checkIndex
 * Remove a specific task check
 */
router.delete("/tasks/:weekKey/:taskId/:checkIndex", (req, res) => {
  const { weekKey, taskId, checkIndex } = req.params;

  const query = `
    DELETE FROM maid_tasks 
    WHERE week_key = ? AND task_id = ? AND check_index = ?
  `;

  db.pool.query(query, [weekKey, taskId, parseInt(checkIndex)], (err, result) => {
    if (err) {
      console.error("Delete task error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      message: "Task check deleted successfully",
    });
  });
});

// =====================================================
// TASK CONFIGURATION ROUTES
// =====================================================

/**
 * GET /maid/task-config
 * Fetch all task configurations
 */
router.get("/task-config", (req, res) => {
  const query = `
    SELECT 
      id,
      task_id as taskId,
      task_name as taskName,
      required_times as requiredTimes,
      image_url as imageUrl,
      is_active as isActive,
      display_order as displayOrder
    FROM maid_task_config
    WHERE is_active = TRUE
    ORDER BY display_order
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch task config error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      tasks: results,
    });
  });
});

/**
 * POST /maid/task-config
 * Add a new task configuration
 */
router.post("/task-config", (req, res) => {
  const { taskId, taskName, requiredTimes, imageUrl } = req.body;

  if (!taskId || !taskName) {
    return res.status(400).json({
      status: false,
      message: "taskId and taskName are required",
    });
  }

  const query = `
    INSERT INTO maid_task_config (task_id, task_name, required_times, image_url)
    VALUES (?, ?, ?, ?)
  `;

  db.pool.query(query, [taskId, taskName, requiredTimes || 1, imageUrl || null], (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({
          status: false,
          message: "Task with this ID already exists",
        });
      }
      console.error("Add task config error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      message: "Task configuration added successfully",
      id: result.insertId,
    });
  });
});

/**
 * PUT /maid/task-config/:taskId
 * Update a task configuration
 */
router.put("/task-config/:taskId", (req, res) => {
  const { taskId } = req.params;
  const { taskName, requiredTimes, imageUrl, isActive, displayOrder } = req.body;

  const updates = [];
  const params = [];

  if (taskName !== undefined) {
    updates.push("task_name = ?");
    params.push(taskName);
  }
  if (requiredTimes !== undefined) {
    updates.push("required_times = ?");
    params.push(requiredTimes);
  }
  if (imageUrl !== undefined) {
    updates.push("image_url = ?");
    params.push(imageUrl);
  }
  if (isActive !== undefined) {
    updates.push("is_active = ?");
    params.push(isActive);
  }
  if (displayOrder !== undefined) {
    updates.push("display_order = ?");
    params.push(displayOrder);
  }

  if (updates.length === 0) {
    return res.status(400).json({
      status: false,
      message: "No fields to update",
    });
  }

  params.push(taskId);

  const query = `UPDATE maid_task_config SET ${updates.join(", ")} WHERE task_id = ?`;

  db.pool.query(query, params, (err, result) => {
    if (err) {
      console.error("Update task config error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Task configuration not found",
      });
    }

    res.json({
      status: true,
      message: "Task configuration updated successfully",
    });
  });
});

// =====================================================
// STATISTICS & REPORTS ROUTES
// =====================================================

/**
 * GET /maid/stats/monthly
 * Get monthly attendance statistics
 * Query params: year, month
 */
router.get("/stats/monthly", (req, res) => {
  const { year, month } = req.query;

  if (!year || month === undefined) {
    return res.status(400).json({
      status: false,
      message: "Year and month are required",
    });
  }

  const startDate = `${year}-${String(parseInt(month) + 1).padStart(2, "0")}-01`;
  const endDate = new Date(parseInt(year), parseInt(month) + 1, 0);
  const endDateStr = formatDateKey(endDate);

  const query = `
    SELECT 
      COUNT(*) as totalRecords,
      SUM(CASE WHEN is_leave = FALSE AND morning_in IS NOT NULL AND morning_out IS NOT NULL 
               AND evening_in IS NOT NULL AND evening_out IS NOT NULL THEN 1 ELSE 0 END) as presentDays,
      SUM(CASE WHEN is_leave = FALSE AND (morning_in IS NOT NULL OR morning_out IS NOT NULL 
               OR evening_in IS NOT NULL OR evening_out IS NOT NULL)
               AND NOT (morning_in IS NOT NULL AND morning_out IS NOT NULL 
               AND evening_in IS NOT NULL AND evening_out IS NOT NULL) THEN 1 ELSE 0 END) as partialDays,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'maid' AND leave_duration = 'full' THEN 1 ELSE 0 END) as maidFullDay,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'maid' AND leave_duration = 'morning' THEN 1 ELSE 0 END) as maidMorning,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'maid' AND leave_duration = 'evening' THEN 1 ELSE 0 END) as maidEvening,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'office' AND leave_duration = 'full' THEN 1 ELSE 0 END) as officeFullDay,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'office' AND leave_duration = 'morning' THEN 1 ELSE 0 END) as officeMorning,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'office' AND leave_duration = 'evening' THEN 1 ELSE 0 END) as officeEvening
    FROM maid_attendance
    WHERE attendance_date BETWEEN ? AND ?
  `;

  db.pool.query(query, [startDate, endDateStr], (err, results) => {
    if (err) {
      console.error("Fetch monthly stats error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    const workingDays = getMonthWorkingDays(parseInt(year), parseInt(month));
    const stats = results[0];

    res.json({
      status: true,
      stats: {
        totalWorkingDays: workingDays.length,
        presentDays: stats.presentDays || 0,
        partialDays: stats.partialDays || 0,
        pendingDays: workingDays.length - (stats.totalRecords || 0),
        maidFullDay: stats.maidFullDay || 0,
        maidMorning: stats.maidMorning || 0,
        maidEvening: stats.maidEvening || 0,
        officeFullDay: stats.officeFullDay || 0,
        officeMorning: stats.officeMorning || 0,
        officeEvening: stats.officeEvening || 0,
      },
    });
  });
});

/**
 * GET /maid/stats/weekly
 * Get weekly attendance statistics
 * Query params: weekKey (YYYY-MM-DD of Monday)
 */
router.get("/stats/weekly", (req, res) => {
  const { weekKey } = req.query;

  if (!weekKey) {
    return res.status(400).json({
      status: false,
      message: "weekKey is required",
    });
  }

  const startDate = new Date(weekKey);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 5); // Monday to Saturday

  const query = `
    SELECT 
      COUNT(*) as totalRecords,
      SUM(CASE WHEN is_leave = FALSE AND morning_in IS NOT NULL THEN 1 ELSE 0 END) as presentDays,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'maid' AND leave_duration = 'full' THEN 1 ELSE 0 END) as maidFullDay,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'maid' AND leave_duration = 'morning' THEN 1 ELSE 0 END) as maidMorning,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'maid' AND leave_duration = 'evening' THEN 1 ELSE 0 END) as maidEvening,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'office' AND leave_duration = 'full' THEN 1 ELSE 0 END) as officeFullDay,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'office' AND leave_duration = 'morning' THEN 1 ELSE 0 END) as officeMorning,
      SUM(CASE WHEN is_leave = TRUE AND leave_type = 'office' AND leave_duration = 'evening' THEN 1 ELSE 0 END) as officeEvening
    FROM maid_attendance
    WHERE attendance_date BETWEEN ? AND ?
  `;

  db.pool.query(query, [formatDateKey(startDate), formatDateKey(endDate)], (err, results) => {
    if (err) {
      console.error("Fetch weekly stats error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    const stats = results[0];

    res.json({
      status: true,
      stats: {
        presentDays: stats.presentDays || 0,
        maidFullDay: stats.maidFullDay || 0,
        maidMorning: stats.maidMorning || 0,
        maidEvening: stats.maidEvening || 0,
        officeFullDay: stats.officeFullDay || 0,
        officeMorning: stats.officeMorning || 0,
        officeEvening: stats.officeEvening || 0,
      },
    });
  });
});

/**
 * GET /maid/export/monthly
 * Get all data for monthly export
 * Query params: year, month
 */
router.get("/export/monthly", (req, res) => {
  const { year, month } = req.query;

  if (!year || month === undefined) {
    return res.status(400).json({
      status: false,
      message: "Year and month are required",
    });
  }

  const workingDays = getMonthWorkingDays(parseInt(year), parseInt(month));
  const startDate = workingDays[0];
  const endDate = workingDays[workingDays.length - 1];

  // Get all week keys for the month
  const weekKeySet = new Set();
  workingDays.forEach((day) => {
    const monday = getWeekMonday(day);
    weekKeySet.add(formatDateKey(monday));
  });
  const uniqueWeekKeys = Array.from(weekKeySet);

  // Fetch attendance
  const attendanceQuery = `
    SELECT 
      DATE_FORMAT(attendance_date, '%Y-%m-%d') as date,
      TIME_FORMAT(morning_in, '%H:%i') as morningIn,
      TIME_FORMAT(morning_out, '%H:%i') as morningOut,
      TIME_FORMAT(evening_in, '%H:%i') as eveningIn,
      TIME_FORMAT(evening_out, '%H:%i') as eveningOut,
      is_leave as isLeave,
      leave_type as leaveType,
      leave_duration as leaveDuration
    FROM maid_attendance
    WHERE attendance_date BETWEEN ? AND ?
    ORDER BY attendance_date
  `;

  // Fetch tasks
  const tasksQuery = `
    SELECT 
      DATE_FORMAT(week_key, '%Y-%m-%d') as weekKey,
      task_id as taskId,
      check_index as checkIndex,
      DATE_FORMAT(completed_date, '%Y-%m-%d') as completedDate
    FROM maid_tasks
    WHERE week_key IN (${uniqueWeekKeys.map(() => "?").join(",")})
  `;

  // Execute both queries
  db.pool.query(attendanceQuery, [startDate, endDate], (err, attendanceResults) => {
    if (err) {
      console.error("Fetch attendance error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    db.pool.query(tasksQuery, uniqueWeekKeys, (err, tasksResults) => {
      if (err) {
        console.error("Fetch tasks error:", err);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: err.message,
        });
      }

      // Process attendance data
      const attendanceMap = {};
      attendanceResults.forEach((row) => {
        attendanceMap[row.date] = {
          morningIn: row.morningIn || "",
          morningOut: row.morningOut || "",
          eveningIn: row.eveningIn || "",
          eveningOut: row.eveningOut || "",
          isLeave: Boolean(row.isLeave),
          leaveType: row.leaveType || "",
          leaveDuration: row.leaveDuration || "",
        };
      });

      // Process tasks data - group by completed date
      const tasksByDate = {};
      tasksResults.forEach((row) => {
        if (!tasksByDate[row.completedDate]) {
          tasksByDate[row.completedDate] = [];
        }
        // Get task name from config (you might want to join with task_config table)
        const taskNames = {
          conference: "Conference Hall",
          bathroom: "Bathroom",
          firstHall: "First Hall",
          secondHall: "Second Hall",
          prayerRoom: "Prayer Room",
          outside: "Outside",
          mdRoom: "MD Room",
          workstation: "Workstation",
          room3D: "3D Room",
          sofa: "Sofa",
        };
        const taskName = taskNames[row.taskId] || row.taskId;
        if (!tasksByDate[row.completedDate].includes(taskName)) {
          tasksByDate[row.completedDate].push(taskName);
        }
      });

      // Build export data
      const exportData = workingDays.map((dateStr) => {
        const date = new Date(dateStr);
        const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
        const attendance = attendanceMap[dateStr] || {};
        const tasks = tasksByDate[dateStr] || [];

        return {
          date: dateStr,
          dayName,
          ...attendance,
          workDone: tasks.length > 0 ? tasks.join(", ") : "-",
        };
      });

      // Calculate stats
      let presentDays = 0, partialDays = 0, pendingDays = 0;
      let maidFullDay = 0, maidMorning = 0, maidEvening = 0;
      let officeFullDay = 0, officeMorning = 0, officeEvening = 0;

      exportData.forEach((row) => {
        if (row.isLeave) {
          if (row.leaveType === "maid") {
            if (row.leaveDuration === "full") maidFullDay++;
            else if (row.leaveDuration === "morning") maidMorning++;
            else if (row.leaveDuration === "evening") maidEvening++;
          } else if (row.leaveType === "office") {
            if (row.leaveDuration === "full") officeFullDay++;
            else if (row.leaveDuration === "morning") officeMorning++;
            else if (row.leaveDuration === "evening") officeEvening++;
          }
        } else if (row.morningIn && row.morningOut && row.eveningIn && row.eveningOut) {
          presentDays++;
        } else if (row.morningIn || row.morningOut || row.eveningIn || row.eveningOut) {
          partialDays++;
        } else {
          pendingDays++;
        }
      });

      res.json({
        status: true,
        data: exportData,
        stats: {
          totalWorkingDays: workingDays.length,
          presentDays,
          partialDays,
          pendingDays,
          maidFullDay,
          maidMorning,
          maidEvening,
          officeFullDay,
          officeMorning,
          officeEvening,
        },
      });
    });
  });
});

module.exports = router;