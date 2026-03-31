const express = require("express");
const router = express.Router();
const {
  Tasks,
  TaskReports,
  TaskReportsReview,
  Project_Details,
} = require("../../Models/DB_Collections");

router.post("/", async (req, res) => {
  try {
    const {
      employeeID,
      projectId,
      taskId,
      activityId,
      percentage,
      status,
      outcome,
      points,
    } = req.body;

    if (!projectId || !taskId) {
      return res
        .status(400)
        .json({ message: "Project ID and Task ID are required" });
    }   

    const newReport = {
      employeeID: employeeID || "",
      projectId,
      taskId,
      activityId: activityId || null,
      percentage: Number(percentage) || 0,
      status: status || "",
      outcome: outcome || "",
      createdAt: new Date(),
    };

    let createdReport;

    if (status === "underReview") {
    
      createdReport = await TaskReportsReview.create(newReport);

      let updateData = {};

      if (activityId) {
        if (points && points.length > 0) {
          updateData = {
            "activities.$[elem].points": points,
          };
        }
      } else {
        if (points && points.length > 0) updateData.points = points;
      }

      if (Object.keys(updateData).length > 0) {
        await Tasks.findOneAndUpdate(
          { _id: taskId },
          { $set: updateData },
          {
            new: true,
            ...(activityId
              ? { arrayFilters: [{ "elem._id": activityId }] }
              : {}),
          },
        );
      }

      return res.status(201).json({
        message: "Under Review Report added successfully",
        report: createdReport,
      });
    }

    createdReport = await TaskReports.create(newReport);

    let updateData = {};

    if (activityId) {
      updateData = {
        "activities.$[elem].percentage": Number(percentage),
      };
      if (points && points.length > 0) {
        updateData["activities.$[elem].points"] = points;
      }
    } else {
      
      updateData = {
        percentage: Number(percentage)
      };

      if (points && points.length > 0) updateData.points = points;
    }

    const updatedTask = await Tasks.findOneAndUpdate(
      { _id: taskId },
      { $set: updateData },
      {
        new: true,
        ...(activityId ? { arrayFilters: [{ "elem._id": activityId }] } : {}),
      },
    );

    const task = await Tasks.findById(taskId);

    let taskPercentage;

    if (task.activities && task.activities.length > 0) {
      const activitiesSum = task.activities.reduce(
        (sum, act) => sum + (act.percentage || 0),
        0,
      );

      taskPercentage = Math.round(activitiesSum / task.activities.length);

      await Tasks.findByIdAndUpdate(taskId, {
        $set: { percentage: taskPercentage },
      });
    } else {
      taskPercentage = task.percentage || Number(percentage);
    }

    const allProjectTasks = await Tasks.find({ projectId });

    if (allProjectTasks.length > 0) {
      const tasksSum = allProjectTasks.reduce(
        (sum, t) => sum + (t.percentage || 0),
        0,
      );

      const projectPercentage = Math.round(tasksSum / allProjectTasks.length);

      await Project_Details.findOneAndUpdate(
        { _id: projectId },
        { $set: { percentage: Number(projectPercentage) } },
        { new: true },
      );
    }

    res.status(201).json({
      message: "Report added and task updated successfully",
      report: createdReport,
      updatedTask,
    });
  } catch (error) {
    console.error("Error in /tasksReports POST:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const { projectId, taskId, activityId } = req.query;

    if (!projectId || !taskId) {
      return res
        .status(400)
        .json({ message: "Project ID and Task ID are required" });
    }

    const filter = { projectId, taskId };
    if (activityId) filter.activityId = activityId;

    const normalReports = await TaskReports.find(filter).lean();
    const reviewReports = await TaskReportsReview.find(filter).lean();

    let reports = [...normalReports, ...reviewReports];

    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (reports.length === 0) {
      return res.status(200).json({
        message: "No reports found",
        reports: [],
      });
    }

    const task = await Tasks.findById(taskId).lean();

    const enrichedReports = reports.map((report, index) => {
      let taskName = task?.taskName || "N/A";
      let activityName = null;

      if (report.activityId && task?.activities) {
        const act = task.activities.find((a) => a._id == report.activityId);
        activityName = act?.activityName || "N/A";
      }

      return {
        sNo: index + 1,
        taskName,
        activityName,
        progress: report.percentage,
        status: report.status,
        outcome: report.outcome,
        date: new Date(report.createdAt).toLocaleDateString("en-GB"),
        time: new Date(report.createdAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        employeeID: report.employeeID,
        reportId: report._id,
      };
    });

    res.status(200).json({
      message: "Reports retrieved successfully",
      reports: enrichedReports,
      totalRecords: enrichedReports.length,
    });
  } catch (error) {
    console.error("Error in /tasksReports GET:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.put("/verify/:reportId", async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, adminRemarks, verifiedBy } = req.body;

    if (!action || !["approved", "declined"].includes(action)) {
      return res.status(400).json({
        message: "Valid action (approved/declined) is required",
      });
    }

    const reviewReport = await TaskReportsReview.findById(reportId).lean();

    if (!reviewReport) {
      return res.status(404).json({
        message: "Report not found in review queue",
      });
    }

    if (action === "declined") {
      await TaskReportsReview.findByIdAndUpdate(reportId, {
        $set: {
          status: "declined",
          adminRemarks: adminRemarks || "",
          verifiedBy: verifiedBy || null,
          verifiedAt: new Date(),
        },
      });

      return res.status(200).json({
        message: "Report declined successfully",
        action: "declined",
      });
    }

    if (action === "approved") {
      const approvedReport = {
        employeeID: reviewReport.employeeID,
        projectId: reviewReport.projectId,
        taskId: reviewReport.taskId,
        activityId: reviewReport.activityId,
        percentage: reviewReport.percentage,
        status: "Completed",
        outcome: reviewReport.outcome,
        createdAt: reviewReport.createdAt,
        adminRemarks: adminRemarks || "",
        verifiedBy: verifiedBy || null,
        verifiedAt: new Date(),
      };

      const newReport = await TaskReports.create(approvedReport);


      let updateData = {};
      const { taskId, activityId, percentage } = reviewReport;

      if (activityId) {
        const task = await Tasks.findById(taskId);
        const activity = task.activities.id(activityId);

        updateData = {
          "activities.$[elem].percentage": Number(percentage),
        };
      } else {

        updateData = {
          percentage: Number(percentage),
        };
      }

      await Tasks.findOneAndUpdate(
        { _id: taskId },
        { $set: updateData },
        {
          new: true,
          ...(activityId ? { arrayFilters: [{ "elem._id": activityId }] } : {}),
        },
      );

      const task = await Tasks.findById(taskId);
      if (task.activities && task.activities.length > 0) {
        const activitiesSum = task.activities.reduce(
          (sum, act) => sum + (act.percentage || 0),
          0,
        );
        const taskPercentage = Math.round(
          activitiesSum / task.activities.length,
        );
        await Tasks.findByIdAndUpdate(taskId, {
          $set: { percentage: taskPercentage },
        });
      }

      const allProjectTasks = await Tasks.find({
        projectId: reviewReport.projectId,
      });
      if (allProjectTasks.length > 0) {
        const tasksSum = allProjectTasks.reduce(
          (sum, t) => sum + (t.percentage || 0),
          0,
        );
        const projectPercentage = Math.round(tasksSum / allProjectTasks.length);
        await Project_Details.findOneAndUpdate(
          { _id: reviewReport.projectId },
          { $set: { percentage: Number(projectPercentage) } },
          { new: true },
        );
      }

      await TaskReportsReview.findByIdAndDelete(reportId);

      return res.status(200).json({
        message: "Report approved and moved to completed reports",
        action: "approved",
        newReport,
      });
    }
  } catch (error) {
    console.error("Error verifying report:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});
module.exports = router;
