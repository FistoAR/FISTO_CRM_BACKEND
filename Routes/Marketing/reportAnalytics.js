const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");

// ========================================
// GET /api/marketing/report-analytics/overview
// ========================================
router.get("/overview", (req, res) => {
  console.log("GET /api/marketing/report-analytics/overview called");
  const { employee_id, time_range } = req.query;

  // Step 1: Get total tasks from marketing_task
  let totalTasksWhereClause = "WHERE is_active = 1 AND assign_status = 'ASSIGN'";
  const totalTasksParams = [];

  if (employee_id) {
    totalTasksWhereClause += " AND employee_id = ?";
    totalTasksParams.push(employee_id);
  }

  // Add time_range filter for marketing_task
  if (time_range === "today") {
    totalTasksWhereClause += " AND (task_type = 'CONCURRENT' OR (task_type = 'SEQUENTIAL' AND seq_range = 'TODAY'))";
  } else if (time_range === "weekly") {
    totalTasksWhereClause += " AND task_type = 'SEQUENTIAL' AND seq_range = 'WEEKLY'";
  } else if (time_range === "monthly") {
    totalTasksWhereClause += " AND task_type = 'SEQUENTIAL' AND seq_range = 'MONTHLY'";
  }

  const totalTasksQuery = `
    SELECT COUNT(*) as total
    FROM marketing_task
    ${totalTasksWhereClause}
  `;

  db.pool.query(totalTasksQuery, totalTasksParams, (err, totalResult) => {
    if (err) {
      console.error("Total tasks fetch error:", err);
      return res.status(500).json({
        success: false,
        message: "DB error",
        error: err.message,
      });
    }

    const totalTasks = totalResult[0].total;

    // Step 2: Get marketing_task_emp data with formatted datetime
    // FIX: For TODAY tasks, use created_at as task_date. For WEEKLY/MONTHLY, use date column
    let empWhereClause = "WHERE mt.is_active = 1 AND mt.assign_status = 'ASSIGN'";
    const empParams = [];

    if (employee_id) {
      empWhereClause += " AND mt.employee_id = ?";
      empParams.push(employee_id);
    }

    if (time_range === "today") {
      empWhereClause += " AND mte.time_range = 'today'";
    } else if (time_range === "weekly") {
      empWhereClause += " AND mte.time_range = 'weekly'";
    } else if (time_range === "monthly") {
      empWhereClause += " AND mte.time_range = 'monthly'";
    }

    const taskEmpQuery = `
      SELECT
        mte.id,
        mte.task_id,
        mte.task_name,
        mte.employee_name,
        mte.category,
        mte.time_range,
        DATE_FORMAT(mte.deadline_date, '%Y-%m-%d') as deadline_date,
        mte.deadline_time,
        DATE_FORMAT(
          CASE 
            WHEN mte.time_range = 'today' THEN mte.created_at
            ELSE mte.date
          END, '%Y-%m-%d'
        ) as task_date,
        mte.progress,
        mte.status,
        DATE_FORMAT(mte.updated_at, '%Y-%m-%d') as completed_date,
        HOUR(mte.updated_at) * 60 + MINUTE(mte.updated_at) as completed_minutes
      FROM marketing_task_emp mte
      INNER JOIN marketing_task mt ON mt.marketing_task_id = mte.task_id
      ${empWhereClause}
    `;

    db.pool.query(taskEmpQuery, empParams, (err, taskEmpRows) => {
      if (err) {
        console.error("Task emp fetch error:", err);
        return res.status(500).json({
          success: false,
          message: "DB error",
          error: err.message,
        });
      }

      console.log("Total tasks from marketing_task:", totalTasks);
      console.log("Task emp rows fetched:", taskEmpRows.length);

      let completedTasks = 0;
      let completedOnTime = 0;
      let completedDelayed = 0;
      let inProgressTasks = 0;
      let inProgressOnGoing = 0;
      let inProgressOverdue = 0;
      let totalProgressSum = 0;
      let totalProgressCount = 0;

      const now = new Date();
      const currentDate = now.toISOString().split("T")[0];
      const currentTime = now.getHours() * 60 + now.getMinutes();

      taskEmpRows.forEach((row) => {
        if (row.progress != null) {
          totalProgressSum += row.progress;
          totalProgressCount++;
        }

        const timeRange = row.time_range;
        const taskDate = row.task_date;
        const deadlineDate = row.deadline_date;
        const deadlineTime = row.deadline_time;

        let deadlineMinutes = null;
        if (deadlineTime === "MORNING") {
          deadlineMinutes = 13 * 60 + 30; // 1:30 PM = 810 minutes
        } else if (deadlineTime === "EVENING") {
          deadlineMinutes = 18 * 60 + 30; // 6:30 PM = 1110 minutes
        }

        // Calculate if task is overdue (for In Progress tasks)
        let isOverdue = false;

        if (timeRange === "today") {
          if (taskDate && deadlineMinutes !== null) {
            if (currentDate > taskDate) {
              isOverdue = true;
            } else if (currentDate === taskDate && currentTime > deadlineMinutes) {
              isOverdue = true;
            }
          }
        } else if (timeRange === "weekly" || timeRange === "monthly") {
          if (deadlineDate && deadlineMinutes !== null) {
            if (currentDate > deadlineDate) {
              isOverdue = true;
            } else if (currentDate === deadlineDate && currentTime > deadlineMinutes) {
              isOverdue = true;
            }
          }
        }

        // Process completed tasks
        if (row.status === "Completed") {
          completedTasks++;

          const completedDate = row.completed_date;
          const completedMinutes = row.completed_minutes;

          // FIX: For TODAY tasks, use taskDate (created_at converted to date)
          // For WEEKLY/MONTHLY, use deadlineDate
          let referenceDate = null;
          if (timeRange === "today") {
            referenceDate = taskDate; // Use created_at date for TODAY tasks
          } else if (timeRange === "weekly" || timeRange === "monthly") {
            referenceDate = deadlineDate; // Use deadline_date for WEEKLY/MONTHLY
          }

          // Check if we have all required data
          if (
            completedDate &&
            completedMinutes !== null &&
            referenceDate &&
            deadlineMinutes !== null
          ) {
            let completedOnTimeFlag = false;

            // Compare dates and times
            if (completedDate < referenceDate) {
              // Completed before deadline date
              completedOnTimeFlag = true;
            } else if (completedDate === referenceDate) {
              // Completed on deadline date - check time
              if (completedMinutes <= deadlineMinutes) {
                completedOnTimeFlag = true;
              }
            }

            if (completedOnTimeFlag) {
              completedOnTime++;
              const completedHour = Math.floor(completedMinutes / 60);
              const completedMin = completedMinutes % 60;
              const deadlineHour = Math.floor(deadlineMinutes / 60);
              const deadlineMin = deadlineMinutes % 60;

              console.log(`✅ ON TIME - Task "${row.task_name}" (ID: ${row.id})`);
              console.log(`   Time Range: ${timeRange}`);
              console.log(
                `   Completed: ${completedDate} at ${completedHour}:${String(
                  completedMin
                ).padStart(2, "0")} (${completedMinutes} min)`
              );
              console.log(
                `   Deadline: ${referenceDate} at ${deadlineHour}:${String(
                  deadlineMin
                ).padStart(2, "0")} (${deadlineMinutes} min)`
              );
            } else {
              completedDelayed++;
              const completedHour = Math.floor(completedMinutes / 60);
              const completedMin = completedMinutes % 60;
              const deadlineHour = Math.floor(deadlineMinutes / 60);
              const deadlineMin = deadlineMinutes % 60;

              console.log(`⏰ DELAYED - Task "${row.task_name}" (ID: ${row.id})`);
              console.log(`   Time Range: ${timeRange}`);
              console.log(
                `   Completed: ${completedDate} at ${completedHour}:${String(
                  completedMin
                ).padStart(2, "0")} (${completedMinutes} min)`
              );
              console.log(
                `   Deadline: ${referenceDate} at ${deadlineHour}:${String(
                  deadlineMin
                ).padStart(2, "0")} (${deadlineMinutes} min)`
              );
            }
          } else {
            // Missing data - mark as delayed
            completedDelayed++;
            console.log(
              `❌ DELAYED (Missing Data) - Task "${row.task_name}" (ID: ${row.id})`
            );
            console.log(`   Time Range: ${timeRange}`);
            console.log(`   Completed Date: ${completedDate || "NULL"}`);
            console.log(
              `   Completed Minutes: ${
                completedMinutes !== null ? completedMinutes : "NULL"
              }`
            );
            console.log(`   Reference Date: ${referenceDate || "NULL"}`);
            console.log(`   Task Date: ${taskDate || "NULL"}`);
            console.log(`   Deadline Date: ${deadlineDate || "NULL"}`);
            console.log(`   Deadline Time: ${deadlineTime || "NULL"}`);
            console.log(
              `   Deadline Minutes: ${
                deadlineMinutes !== null ? deadlineMinutes : "NULL"
              }`
            );
          }
        }
        // Process in-progress tasks
        else if (row.status === "In Progress") {
          inProgressTasks++;
          if (isOverdue) {
            inProgressOverdue++;
          } else {
            inProgressOnGoing++;
          }
        }
      });

      // Calculate Not Started
      const notStarted = totalTasks - taskEmpRows.length;
      const avgProgress = totalProgressCount > 0
        ? Math.round(totalProgressSum / totalProgressCount)
        : 0;

      console.log("=".repeat(70));
      console.log(
        `📊 FINAL STATS - Total: ${totalTasks}, Completed: ${completedTasks} (On Time: ${completedOnTime}, Delayed: ${completedDelayed}), In Progress: ${inProgressTasks} (On Going: ${inProgressOnGoing}, Overdue: ${inProgressOverdue}), Not Started: ${notStarted}`
      );
      console.log("=".repeat(70));

      const statusDistribution = [
        { name: "Completed", value: completedTasks },
        { name: "On Time", value: completedOnTime },
        { name: "Delayed", value: completedDelayed },
        { name: "In Progress", value: inProgressTasks },
        { name: "On Going", value: inProgressOnGoing },
        { name: "Overdue", value: inProgressOverdue },
        { name: "Not Started", value: notStarted },
      ];

      const timeRangeQuery = `
        SELECT
          mte.time_range AS name,
          COUNT(*) AS value
        FROM marketing_task_emp mte
        INNER JOIN marketing_task mt ON mt.marketing_task_id = mte.task_id
        ${empWhereClause}
        GROUP BY mte.time_range
        ORDER BY
          CASE mte.time_range
            WHEN 'today' THEN 1
            WHEN 'weekly' THEN 2
            WHEN 'monthly' THEN 3
            ELSE 4
          END
      `;

      db.pool.query(timeRangeQuery, empParams, (err, timeRangeRows) => {
        if (err) {
          console.error("Time range fetch error:", err);
          return res.status(500).json({
            success: false,
            message: "DB error",
            error: err.message,
          });
        }

        const categoryQuery = `
          SELECT
            mte.category AS category,
            COUNT(*) AS count
          FROM marketing_task_emp mte
          INNER JOIN marketing_task mt ON mt.marketing_task_id = mte.task_id
          ${empWhereClause}
          GROUP BY mte.category
          ORDER BY count DESC
          LIMIT 10
        `;

        db.pool.query(categoryQuery, empParams, (err, categoryRows) => {
          if (err) {
            console.error("Category fetch error:", err);
            return res.status(500).json({
              success: false,
              message: "DB error",
              error: err.message,
            });
          }

          const trendQuery = `
            SELECT
              DATE_FORMAT(mte.created_at, '%Y-%m-%d') AS date,
              SUM(CASE WHEN mte.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN mte.status = 'In Progress' THEN 1 ELSE 0 END) AS inProgress
            FROM marketing_task_emp mte
            INNER JOIN marketing_task mt ON mt.marketing_task_id = mte.task_id
            WHERE mt.is_active = 1 AND mt.assign_status = 'ASSIGN'
              ${employee_id ? "AND mt.employee_id = ?" : ""}
              AND mte.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE_FORMAT(mte.created_at, '%Y-%m-%d')
            ORDER BY date ASC
          `;

          const trendParams = employee_id ? [employee_id] : [];

          db.pool.query(trendQuery, trendParams, (err, trendRows) => {
            if (err) {
              console.error("Trend fetch error:", err);
              return res.status(500).json({
                success: false,
                message: "DB error",
                error: err.message,
              });
            }

            res.json({
              success: true,
              data: {
                totalTasks,
                completedTasks,
                completedOnTime,
                completedDelayed,
                inProgressTasks,
                inProgressOnGoing,
                inProgressOverdue,
                notStarted,
                avgProgress,
                statusDistribution,
                timeRangeDistribution: timeRangeRows,
                categoryBreakdown: categoryRows,
                trendData: trendRows,
              },
            });
          });
        });
      });
    });
  });
});

// ========================================
// GET /api/marketing/report-analytics/details
// ========================================
router.get("/details", (req, res) => {
  console.log("GET /api/marketing/report-analytics/details called");

  const { employee_id, time_range } = req.query;

  let whereClause = "WHERE mt.is_active = 1 AND mt.assign_status = 'ASSIGN'";
  const params = [];

  if (employee_id) {
    whereClause += " AND mt.employee_id = ?";
    params.push(employee_id);
  }

  if (time_range === "today") {
    whereClause += " AND mte.time_range = 'today'";
  } else if (time_range === "weekly") {
    whereClause += " AND mte.time_range = 'weekly'";
  } else if (time_range === "monthly") {
    whereClause += " AND mte.time_range = 'monthly'";
  }

  const query = `
    SELECT 
      mte.id,
      mte.task_id,
      mte.task_name,
      mte.task_description,
      mte.employee_name,
      mte.employee_id,
      mte.category,
      mte.time_range,
      mte.progress,
      mte.status,
      mte.deadline_date AS deadline,
      mte.deadline_time,
      mte.date,
      mte.created_at,
      mte.updated_at
    FROM marketing_task_emp mte
    INNER JOIN marketing_task mt
      ON mt.marketing_task_id = mte.task_id
    ${whereClause}
    ORDER BY mte.created_at DESC
  `;

  db.pool.query(query, params, (err, results) => {
    if (err) {
      console.error("Details fetch error:", err);
      return res.status(500).json({
        success: false,
        message: "DB error",
        error: err.message,
      });
    }

    console.log(`Found ${results.length} tasks for details view`);

    res.json({
      success: true,
      data: results,
    });
  });
});

// ========================================
// GET /api/marketing/report-analytics/history/:taskId
// ========================================
router.get("/history/:taskId", (req, res) => {
  console.log("GET /api/marketing/report-analytics/history/:taskId called");

  const { taskId } = req.params;

  const query = `
    SELECT 
      mhr.id,
      mhr.task_id as emp_task_id,
      mhr.employee_id,
      mhr.employee_name,
      mhr.progress,
      mhr.status,
      mhr.remarks,
      mhr.submitted_at,
      mte.task_name,
      mte.task_description,
      mte.time_range
    FROM marketing_history_report mhr
    INNER JOIN marketing_task_emp mte ON mhr.task_id = mte.id
    WHERE mte.id = ?
    ORDER BY mhr.submitted_at DESC
  `;

  db.pool.query(query, [taskId], (err, results) => {
    if (err) {
      console.error("History fetch error:", err);
      return res.status(500).json({
        success: false,
        message: "DB error",
        error: err.message,
      });
    }

    console.log(`Found ${results.length} history records for task ${taskId}`);

    res.json({
      success: true,
      data: results,
    });
  });
});

module.exports = router;
