const express = require("express");
const router = express.Router();
const {
  Project_Details,
  UnscheduledTask,
} = require("../../Models/DB_Collections");
const { queryWithRetry } = require("../../dataBase/connection");


router.get("/projectNames", async (req, res) => {
  try {
    const data = await Project_Details.aggregate([
      {
        $project: {
          _id: 0,
          projectName: 1,
        },
      },
    ]);

    const employeeData = await queryWithRetry(`
      SELECT 
        employee_id as id,
        employee_name as name,
        profile_url as profile,
        designation as department
      FROM employees_details 
      WHERE (team_head = 1 OR designation = 'Project Head')
      AND working_status = 'Active'
    `);

    const FinalData = {
      projectNames: data,
      employees: employeeData
    }

    res.status(200).json(FinalData);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching project names",
      error: error.message,
    });
  }
});

router.post("/create", async (req, res) => {
  try {
    const { taskName, projectName, startTime, endTime, report, reportingPerson, employeeID } = req.body;
    if (!taskName) {
      return res.status(400).json({ message: "Task name is required" });
    }

    const newTask = new UnscheduledTask({
      taskName,
      projectName: projectName || "",
      startTime,
      endTime,
      reports: report,
      reportingPerson,
      status: "In Progress",
      outcomes: "",
      adminApprovedAt: "",
      employeeID,
    });

    await newTask.save();

    res.status(201).json({
      message: "Task created successfully",
      data: newTask,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error creating task",
      error: error.message,
    });
  }
});

router.get("/reports/:employeeID", async (req, res) => {
  try {
    const { employeeID } = req.params;
    const { startDate, endDate } = req.query;

    const query = { employeeID };

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      query.createdAt = {
        $gte: start,
        $lte: end
      };
    }

    const reports = await UnscheduledTask.find(query)
      .sort({ createdAt: -1 });

    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching reports",
      error: error.message,
    });
  }
});

// Get today's tasks for update
router.get("/today/:employeeID", async (req, res) => {
  try {
    const { employeeID } = req.params;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayTasks = await UnscheduledTask.find({
      employeeID,
      createdAt: {
        $gte: today,
        $lt: tomorrow
      }
    }).sort({ createdAt: -1 });

    res.status(200).json(todayTasks);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching today's tasks",
      error: error.message,
    });
  }
});

// Update task with outcomes
router.put("/update/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { outcomes } = req.body;

    if (!outcomes) {
      return res.status(400).json({ message: "Outcomes are required" });
    }

    const updatedTask = await UnscheduledTask.findByIdAndUpdate(
      taskId,
      {
        outcomes,
        status: "Under Review"
      },
      { new: true }
    );

    if (!updatedTask) {
      return res.status(404).json({ message: "Task not found" });
    }

    res.status(200).json({
      message: "Task updated successfully",
      data: updatedTask,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error updating task",
      error: error.message,
    });
  }
});

// Get all tasks under review filtered by reportingPerson (for admin/team head)
router.get("/review-reports/:employeeID", async (req, res) => {
  try {
    const { employeeID } = req.params;
    
    const reviewTasks = await UnscheduledTask.aggregate([
      {
        $match: { 
          status: "Under Review",
          reportingPerson: employeeID
        }
      },
      {
        $project: {
          _id: 1,
          taskName: 1,
          projectName: 1,
          startTime: 1,
          endTime: 1,
          reports: 1,
          outcomes: 1,
          status: 1,
          createdAt: 1,
          employeeID: 1,
          employeeName: 1,
          reportingPerson: 1
        }
      },
      {
        $sort: { createdAt: -1 }
      }
    ]);

    const tasksWithEmployeeNames = await Promise.all(
      reviewTasks.map(async (task) => {
        try {
          const employeeDetails = await queryWithRetry(`
            SELECT employee_name 
            FROM employees_details 
            WHERE employee_id = ?
          `, [task.employeeID]);
          
          return {
            ...task,
            employeeName: employeeDetails?.[0]?.employee_name || "N/A"
          };
        } catch (err) {
          return {
            ...task,
            employeeName: "N/A"
          };
        }
      })
    );

    res.status(200).json(tasksWithEmployeeNames);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching review reports",
      error: error.message,
    });
  }
});

// Admin updates task status
router.put("/admin-update/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;

    const validStatuses = ["In Progress", "Delayed Completed", "Completed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const updatedTask = await UnscheduledTask.findByIdAndUpdate(
      taskId,
      {
        status,
        adminApprovedAt: new Date().toISOString()
      },
      { new: true }
    );

    if (!updatedTask) {
      return res.status(404).json({ message: "Task not found" });
    }

    res.status(200).json({
      message: "Status updated successfully",
      data: updatedTask,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error updating status",
      error: error.message,
    });
  }
});

module.exports = router;