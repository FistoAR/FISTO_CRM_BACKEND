const express = require("express");
const router = express.Router();
const {
  Tasks,
  DayReport,
  TaskReports,
  TaskReportsReview,
} = require("../../Models/DB_Collections");

router.post("/", async (req, res) => {
  try {
    const { projectId, taskId, activityId, employeeID } = req.body;

    if (!projectId || !employeeID) {
      return res.status(400).json({
        success: false,
        message: "projectId and employeeID are required",
      });
    }

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const todayEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    const query = {
      employeeID,
      createdAt: {
        $gte: todayStart,
        $lte: todayEnd,
      },
    };

    if (taskId) {
      query.taskId = taskId;
    }

    if (activityId) {
      query.activityId = activityId;
    }

    const existingReport = await DayReport.findOne(query);

    if (existingReport) {
      return res.status(400).json({
        success: false,
        message: "Day report already exists for this task/activity today",
      });
    }

    const dayReport = new DayReport({
      projectId,
      taskId: taskId || "",
      activityId: activityId || null,
      employeeID,
    });

    await dayReport.save();

    res.status(201).json({
      success: true,
      message: "Day report created successfully",
      data: dayReport,
    });
  } catch (error) {
    console.error("Error creating day report:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create day report",
      error: error.message,
    });
  }
});

router.delete("/", async (req, res) => {
  try {
    const { employeeID, taskId, activityId } = req.body;

    if (!employeeID) {
      return res.status(400).json({
        success: false,
        message: "employeeID is required",
      });
    }

    const query = { employeeID };

    if (taskId) {
      query.taskId = taskId;
    }

    if (activityId) {
      query.activityId = activityId;
    }

    const dayReport = await DayReport.findOne(query);

    if (!dayReport) {
      return res.status(404).json({
        success: false,
        message: "Day report not found",
      });
    }

    let hasStartedWork = false;
    let workDetails = null;

    if (taskId && !activityId) {
      const taskReport = await TaskReports.findOne({
        taskId: taskId,
        activityId: null,
      }).lean();

      const taskReportReview = await TaskReportsReview.findOne({
        taskId: taskId,
        activityId: null,
      }).lean();

      if (taskReport || taskReportReview) {
        const percentage =
          taskReport?.percentage || taskReportReview?.percentage || 0;

        if (percentage > 0) {
          hasStartedWork = true;
          workDetails = {
            type: "task",
            percentage: percentage,
            message: `You have already started work on this task (${percentage}% completed). \n Cannot remove from today's tasks.`,
          };
        }
      }
    }

    if (activityId) {
      const activityReport = await TaskReports.findOne({
        activityId: activityId,
      }).lean();

      const activityReportReview = await TaskReportsReview.findOne({
        activityId: activityId,
      }).lean();

      if (activityReport || activityReportReview) {
        const percentage =
          activityReport?.percentage || activityReportReview?.percentage || 0;

        if (percentage > 0) {
          hasStartedWork = true;
          workDetails = {
            type: "activity",
            percentage: percentage,
            message: `You have already started work on this activity (${percentage}% completed). Cannot remove from today's tasks.`,
          };
        }
      }
    }

    if (hasStartedWork) {
      return res.status(200).json({
        success: false,
        canRemove: false,
        message: workDetails.message,
        data: workDetails,
      });
    }

    const deletedReport = await DayReport.findOneAndDelete(query);

    res.status(200).json({
      success: true,
      canRemove: true,
      message: "Day report removed successfully",
      data: deletedReport,
    });
  } catch (error) {
    console.error("Error deleting day report:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete day report",
      error: error.message,
    });
  }
});

router.get("/employee/:employeeID", async (req, res) => {
  try {
    const { employeeID } = req.params;

    if (!employeeID) {
      return res.status(400).json({
        success: false,
        message: "employeeID is required",
      });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const dayReports = await DayReport.find({
      employeeID,
      createdAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    });

    const filteredReports = [];

    for (const report of dayReports) {
      const task = await Tasks.findById(report.taskId);

      if (!task) continue;

      if (report.activityId) {
        const activity = task.activities?.find(
          (act) => act._id.toString() === report.activityId.toString(),
        );

        const activityReportReview = await TaskReportsReview.findOne({
          activityId: report.activityId,
          percentage: 100,
        })
          .sort({ createdAt: -1 })
          .lean();

        if (activity && activity.percentage < 100 && !activityReportReview) {
          filteredReports.push(report);
        }
      } else {
        const TaskReportReview = await TaskReportsReview.findOne({
          taskId: report.taskId,
          percentage: 100,
        })
          .sort({ createdAt: -1 })
          .lean();
        if (task.percentage < 100 && !TaskReportReview) {
          filteredReports.push(report);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Day reports fetched successfully",
      data: filteredReports,
    });
  } catch (error) {
    console.error("Error fetching day reports:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch day reports",
      error: error.message,
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const dayReports = await DayReport.find();

    res.status(200).json({
      success: true,
      message: "All day reports fetched successfully",
      data: dayReports,
    });
  } catch (error) {
    console.error("Error fetching all day reports:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch day reports",
      error: error.message,
    });
  }
});

router.get("/detailed/employee/:employeeID", async (req, res) => {
  try {
    const { employeeID } = req.params;

    if (!employeeID) {
      return res.status(400).json({
        success: false,
        message: "employeeID is required",
      });
    }

    const dayReports = await DayReport.find({ employeeID })
      .populate("projectId")
      .populate("taskId");

    res.status(200).json({
      success: true,
      message: "Day reports with details fetched successfully",
      data: dayReports,
    });
  } catch (error) {
    console.error("Error fetching detailed day reports:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch day reports",
      error: error.message,
    });
  }
});

module.exports = router;
