const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const {
  Project_Details,
  Tasks,
  TaskReports,
  UnscheduledTask,
  DayReport,
} = require("../../../Models/DB_Collections");
const { queryWithRetry } = require("../../../dataBase/connection");

const getEffectiveDeadline = (project) => {
  let projectDeadline = null;

  if (project.correctionDate && project.correctionDate.length > 0) {
    const latestCorrection =
      project.correctionDate[project.correctionDate.length - 1];
    projectDeadline = new Date(latestCorrection.date);

    if (latestCorrection.time) {
      const datePart = projectDeadline.toISOString().split("T")[0];
      const [hours, minutes] = latestCorrection.time.split(":");
      projectDeadline = new Date(`${datePart}T${latestCorrection.time}`);
    } else {
      projectDeadline.setHours(23, 59, 59, 999);
    }
  } else if (project.endDate) {
    projectDeadline = new Date(project.endDate);
    projectDeadline.setHours(23, 59, 59, 999);
  }

  return projectDeadline;
};

const calculateHoldDuration = (statusHistory) => {
  if (!statusHistory || !Array.isArray(statusHistory)) return 0;
  let totalHoldMs = 0;
  let holdStartTime = null;

  statusHistory.forEach((historyItem) => {
    if (historyItem.status === "Hold" && !holdStartTime) {
      holdStartTime = new Date(historyItem.createdAt);
    } else if (historyItem.status !== "Hold" && holdStartTime) {
      const holdEndTime = new Date(historyItem.createdAt);
      totalHoldMs += holdEndTime.getTime() - holdStartTime.getTime();
      holdStartTime = null;
    }
  });

  if (holdStartTime) {
    const now = new Date();
    totalHoldMs += now.getTime() - holdStartTime.getTime();
  }

  return totalHoldMs;
};

const getEmployeesFromMySQL = () => {
  return new Promise(async (resolve, reject) => {
    const query = `SELECT 
      employee_id as id,
      employee_name as name,
      profile_url as profile,
      designation as role
    FROM employees_details 
    WHERE working_status = 'Active'`;
    
    try {
      const results = await queryWithRetry(query);
      const employeeMap = new Map(
        results.map((emp) => [emp.id.toString(), emp])
      );
      resolve(employeeMap);
    } catch (error) {
      console.error("Error fetching employees from MySQL:", error);
      resolve(new Map());
    }
  });
};

router.get("/overview", async (req, res) => {
  try {
    const [projectsFromDb, allTasks, allReports] =
      await Promise.all([
        Project_Details.find().sort({ createdAt: -1 }).lean(),
        Tasks.find().sort({ createdAt: -1 }).lean(),
        TaskReports.find().sort({ createdAt: -1 }).lean(),
      ]);

    const currentDate = new Date();

    const tasksByProject = allTasks.reduce((acc, task) => {
      const projectId = task.projectId.toString();
      if (!acc[projectId]) acc[projectId] = [];
      acc[projectId].push(task);
      return acc;
    }, {});

    const overallStats = {
      completed: 0,
      ongoing: 0,
      overdue: 0,
      delayed: 0,
      hold: 0,
      canceled: 0,
    };

    const projectsWithStatus = projectsFromDb.map((project) => {
      const projectPercentage = project.percentage || 0;
      const projectTasks = tasksByProject[project._id.toString()] || [];

      let projectStatus = "Not Started";

      if (project.status === "Hold") {
        overallStats.hold++;
        return {
          projectId: project._id,
          projectName: project.projectName || "Unknown Project",
          status: "Hold",
        };
      }

      if (project.status === "Canceled") {
        overallStats.canceled++;
        return {
          projectId: project._id,
          projectName: project.projectName || "Unknown Project",
          status: "Canceled",
        };
      }

      const projectDeadline = getEffectiveDeadline(project);

      if (projectPercentage === 100) {
        const projectTaskIds = projectTasks.map((t) => t._id.toString());
        const reportsForProject = allReports.filter((r) =>
          projectTaskIds.includes(r.taskId)
        );

        const lastReport =
          reportsForProject.length > 0
            ? reportsForProject.reduce((latest, current) =>
                new Date(current.createdAt) > new Date(latest.createdAt)
                  ? current
                  : latest
              )
            : null;

        const actualCompletionDate = lastReport
          ? new Date(lastReport.createdAt)
          : null;

        if (
          projectDeadline &&
          actualCompletionDate &&
          actualCompletionDate > projectDeadline
        ) {
          projectStatus = "Delayed";
        } else {
          projectStatus = "Completed";
        }
      } else {
        if (projectDeadline && currentDate > projectDeadline) {
          projectStatus = "Overdue";
        } else if (projectPercentage > 0) {
          projectStatus = "In Progress";
        } else {
          projectStatus = "In Progress";
        }
      }

      switch (projectStatus) {
        case "Completed":
          overallStats.completed++;
          break;
        case "In Progress":
          overallStats.ongoing++;
          break;
        case "Overdue":
          overallStats.overdue++;
          break;
        case "Delayed":
          overallStats.delayed++;
          break;
      }

      return {
        projectId: project._id,
        projectName: project.projectName || "Unknown Project",
        status: projectStatus,
      };
    });

    res.json({
      success: true,
      data: {
        projects: projectsWithStatus,
        overallStats: {
          completed: overallStats.completed,
          ongoing: overallStats.ongoing,
          overdue: overallStats.overdue,
          delayed: overallStats.delayed,
          hold: overallStats.hold,
          canceled: overallStats.canceled,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching analytics data",
      error: error.message,
    });
  }
});

router.get("/project/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;

    const projectResults = await Project_Details.find({
      _id: new mongoose.Types.ObjectId(projectId),
    }).lean();

    if (!projectResults || projectResults.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const project = projectResults[0];
    const employeeMap = await getEmployeesFromMySQL();

    const assignedEmployees = (project.employees || [])
      .map(empId => employeeMap.get(empId.toString()))
      .filter(emp => emp !== undefined);

    const currentDate = ["Hold", "Canceled"].includes(project.status)
      ? new Date(project.statusHistory[project.statusHistory.length - 1].createdAt)
      : new Date();

    let projectStartDate = null;
    let projectEndDate = null;
    
    if (project.startDate) {
      projectStartDate = new Date(project.startDate);
    }
    
    projectEndDate = getEffectiveDeadline(project);
    if (projectEndDate) {
      projectEndDate.setHours(23, 59, 59, 999);
    }

    const projectTasks = await Tasks.find({ projectId }).lean();
    const taskIds = projectTasks.map((task) => task._id.toString());
    
    const [taskReports, dayReports] = await Promise.all([
      TaskReports.find({ taskId: { $in: taskIds } }).lean(),
      DayReport.find({ taskId: { $in: taskIds } }).lean(),
    ]);

    let projectStatus = "Not Started";
    const projectPercentage = project.percentage || 0;

    if (projectPercentage === 100) {
      const allTaskReports = taskReports.filter((r) => !r.activityId);
      const activityReports = taskReports.filter((r) => r.activityId);

      const lastReport =
        [...allTaskReports, ...activityReports].length > 0
          ? [...allTaskReports, ...activityReports].reduce((latest, current) =>
              new Date(current.createdAt) > new Date(latest.createdAt)
                ? current
                : latest
            )
          : null;

      const actualCompletionDate = lastReport
        ? new Date(lastReport.createdAt)
        : null;

      if (
        projectEndDate &&
        actualCompletionDate &&
        actualCompletionDate > projectEndDate
      ) {
        projectStatus = "Delayed";
      } else {
        projectStatus = "Completed";
      }
    } else {
      if (currentDate > projectEndDate) {
        projectStatus = "Overdue";
      } else if (projectPercentage > 0 && currentDate < projectEndDate) {
        projectStatus = "In Progress";
      } else if (
        projectPercentage === 0 &&
        projectEndDate &&
        currentDate < projectEndDate
      ) {
        projectStatus = "Not Started";
      } else {
        projectStatus = "In Progress";
      }
    }

    let stats = {
      totalTasks: 0,
      totalActivities: 0,
      completed: 0,
      completedActivities: 0,
      ongoing: 0,
      ongoingActivities: 0,
      delayed: 0,
      delayedActivities: 0,
      overdue: 0,
      overdueActivities: 0,
      hold: 0,
      holdActivities: 0,
      cancelled: 0,
      cancelledActivities: 0,
    };

    const getActualStartDate = (taskId, activityId = null) => {
      const relevantReports = dayReports.filter((r) => {
        if (activityId) {
          return r.activityId === activityId;
        }
        return r.taskId === taskId && !r.activityId;
      });

      if (relevantReports.length === 0) return null;

      const sortedReports = relevantReports.sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
      return sortedReports[0].createdAt;
    };

    const getCompletionDate = (taskId, activityId = null) => {
      const relevantReports = taskReports.filter((r) => {
        if (activityId) {
          return r.activityId === activityId && r.percentage === 100;
        }
        return r.taskId === taskId && r.percentage === 100;
      });

      if (relevantReports.length === 0) return null;

      const sortedReports = relevantReports.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      return sortedReports[0].createdAt;
    };

    const getLastReportDate = (taskId, activityId = null) => {
      const relevantReports = taskReports.filter((r) => {
        if (activityId) {
          return r.activityId === activityId;
        }
        return r.taskId === taskId ;
      });

      if (relevantReports.length === 0) return null;

      const sortedReports = relevantReports.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      return sortedReports[0].createdAt;
    };

    const calculateStatus = (item, actualStartDate, completionDate, isActivity = false) => {
      if (["Hold", "Cancelled"].includes(item.status)) {
        return item.status;
      }

      const percentage = item.percentage || 0;

      const scheduledStartDate = new Date(item.startDate);
      if (item.startTime) {
        const [h = 0, m = 0, s = 0] = item.startTime.split(":").map(Number);
        scheduledStartDate.setHours(h, m, s, 0);
      } else {
        scheduledStartDate.setHours(0, 0, 0, 0);
      }

      const scheduledEndDate = new Date(item.endDate);
      if (item.endTime) {
        const [h = 23, m = 59, s = 59] = item.endTime.split(":").map(Number);
        scheduledEndDate.setHours(h, m, s, 0);
      } else {
        scheduledEndDate.setHours(23, 59, 59, 999);
      }

      const holdMs = calculateHoldDuration(item.statusHistory);
      scheduledEndDate.setTime(scheduledEndDate.getTime() + holdMs);

      const scheduledDuration = scheduledEndDate - scheduledStartDate;

      let status = "Not Started";

      if (percentage === 100) {
        status = "Completed";

        if (completionDate) {
          const actualEndDate = new Date(completionDate);
          const effectiveStartDate = actualStartDate
            ? new Date(actualStartDate)
            : scheduledStartDate;

          const actualDuration = actualEndDate - effectiveStartDate;

          if (actualEndDate > scheduledEndDate || actualDuration > scheduledDuration) {
            status = "Delayed";
          }
        }
      } else if (percentage > 0) {
        status = "In Progress";

        if (currentDate > scheduledEndDate) {
          status = "Overdue";
        } else if (actualStartDate) {
          const effectiveStartDate = new Date(actualStartDate);
          const currentDuration = currentDate - effectiveStartDate;

          if (currentDuration > scheduledDuration) {
            status = "Overdue";
          }
        }
      } else {
        status = currentDate > scheduledEndDate ? "Overdue" : "Not Started";
      }

      return status;
    };

    const tasksWithDetails = projectTasks.map((task) => {
      const hasActivities =
        task.activities &&
        Array.isArray(task.activities) &&
        task.activities.length > 0;

      let taskStatus = "Not Started";
      let taskActualStartDate = null;
      let taskCompletionDate = null;
      let lastReportDate = null;

      if (!hasActivities) {
        stats.totalTasks++;

        const taskIdStr = task._id.toString();
        taskActualStartDate = getActualStartDate(taskIdStr);
        taskCompletionDate = getCompletionDate(taskIdStr);
        lastReportDate = getLastReportDate(taskIdStr);

        taskStatus = calculateStatus(task, taskActualStartDate, taskCompletionDate, false);

        switch (taskStatus) {
          case "Completed":
            stats.completed++;
            break;
          case "Delayed":
            stats.delayed++;
            break;
          case "Overdue":
            stats.overdue++;
            break;
          case "In Progress":
            stats.ongoing++;
            break;
          case "Not Started":
            stats.ongoing++;
            break;
          case "Hold":
            stats.hold++;
            break;
          case "Cancelled":
            stats.cancelled++;
            break;
        }
      }

      if (hasActivities) {
        task.activities = task.activities.map((activity) => {
          stats.totalActivities++;

          const activityIdStr = activity._id.toString();
          const taskIdStr = task._id.toString();

          const activityActualStartDate = getActualStartDate(taskIdStr, activityIdStr);
          const activityCompletionDate = getCompletionDate(taskIdStr, activityIdStr);
          const activityLastReportDate = getLastReportDate(taskIdStr, activityIdStr);

          const activityStatus = calculateStatus(
            activity,
            activityActualStartDate,
            activityCompletionDate,
            true
          );

          switch (activityStatus) {
            case "Completed":
              stats.completedActivities++;
              break;
            case "Delayed":
              stats.delayedActivities++;
              break;
            case "Overdue":
              stats.overdueActivities++;
              break;
            case "In Progress":
              stats.ongoingActivities++;
              break;
            case "Not Started":
              stats.ongoingActivities++;
              break;
            case "Hold":
              stats.holdActivities++;
              break;
            case "Cancelled":
              stats.cancelledActivities++;
              break;
          }

          return {
            ...activity,
            status: activityStatus,
            actualStartDate: activityActualStartDate,
            completionDate: activityCompletionDate,
            lastReportDate: activityLastReportDate,
          };
        });
      }

      if (hasActivities) {
        const activityStatuses = task.activities.map((a) => a.status);
        if (activityStatuses.includes("Overdue")) {
          taskStatus = "Overdue";
        } else if (activityStatuses.includes("Delayed")) {
          taskStatus = "Delayed";
        } else if (activityStatuses.includes("In Progress")) {
          taskStatus = "In Progress";
        } else if (activityStatuses.every((s) => s === "Completed")) {
          taskStatus = "Completed";
        } else {
          taskStatus = "Not Started";
        }
      }

      return {
        ...task,
        status: taskStatus,
        actualStartDate: taskActualStartDate,
        completionDate: taskCompletionDate,
        lastReportDate: lastReportDate,
      };
    });

    res.json({
      success: true,
      data: {
        project: {
          projectId: project._id,
          projectName: project.projectName,
          companyName: project.companyName,
          projectDescription: project.projectDescription,
          colorCode: project.colorCode,
          priority: project.priority,
          percentage: project.percentage,
          employees: assignedEmployees,
          startDate: projectStartDate,
          endDate: projectEndDate,
          status: projectStatus,
          projectStatus: project.status,
          projectType: project.projectType,
        },
        tasks: tasksWithDetails.slice().reverse(),
        stats: stats,
      },
    });
  } catch (error) {
    console.error("Error fetching project analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching project analytics",
      error: error.message,
    });
  }
});


router.get("/timeline", async (req, res) => {
  try {
    const projects = await Project_Details.find({
      status: { $nin: ["Hold", "Canceled"] },
    }).lean();

    if (projects.length === 0) {
      return res.json({
        success: true,
        data: { timeline: [], startDate: null },
      });
    }

    const [allReports] = await Promise.all([
      TaskReports.find().lean(),
    ]);

    // const outcomeMap = new Map(allOutcomes.map((o) => [o.clientId, o]));

    const earliestProject = projects.reduce((earliest, project) => {
      const projectDate = new Date(project.createdAt);
      return projectDate < earliest ? projectDate : earliest;
    }, new Date());

    const currentDate = new Date();
    const monthsDiff =
      (currentDate.getFullYear() - earliestProject.getFullYear()) * 12 +
      (currentDate.getMonth() - earliestProject.getMonth()) +
      1;

    const timelineData = [];

    const latestProjectReportsMap = new Map();
    const reportsByProject = new Map();

    allReports.forEach((report) => {
      if (!reportsByProject.has(report.projectId)) {
        reportsByProject.set(report.projectId, []);
      }
      reportsByProject.get(report.projectId).push(report);
    });

    reportsByProject.forEach((reports, projectId) => {
      const latestReport = reports.reduce((latest, current) =>
        new Date(current.createdAt) > new Date(latest.createdAt)
          ? current
          : latest
      );
      latestProjectReportsMap.set(projectId, latestReport);
    });

    for (let i = 0; i < monthsDiff; i++) {
      const monthStart = new Date(
        earliestProject.getFullYear(),
        earliestProject.getMonth() + i,
        1,
        0,
        0,
        0,
        0
      );

      const monthEnd = new Date(
        earliestProject.getFullYear(),
        earliestProject.getMonth() + i + 1,
        0,
        23,
        59,
        59,
        999
      );

      let completed = 0;
      let delayed = 0;

      projects.forEach((project) => {
        const projectPercentage = project.percentage || 0;

        if (projectPercentage !== 100) {
          return;
        }

        const projectDeadline = getEffectiveDeadline(project);

        if (!projectDeadline) {
          return;
        }

        const latestReport = latestProjectReportsMap.get(
          project._id.toString()
        );
        const completionDate = latestReport
          ? new Date(latestReport.createdAt)
          : null;

        if (
          completionDate &&
          completionDate >= monthStart &&
          completionDate <= monthEnd
        ) {
          if (completionDate > projectDeadline) {
            delayed++;
          } else {
            completed++;
          }
        }
      });

      timelineData.push({
        month: monthStart.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        completed,
        delayed,
      });
    }

    res.json({
      success: true,
      data: {
        timeline: timelineData,
        startDate: earliestProject,
      },
    });
  } catch (error) {
    console.error("Error fetching timeline data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching timeline data",
      error: error.message,
    });
  }
});

router.get("/team-members", async (req, res) => {
  try {
    const [
      projectsFromDb,
      allTasks,
      allReports,
    ] = await Promise.all([
      Project_Details.find().sort({ createdAt: -1 }).lean(),
      Tasks.find().lean(),
      TaskReports.find().lean(),
    ]);

    // Get team heads for three departments
    const teamHeadsQuery = `SELECT 
      employee_id as id,
      employee_name as name,
      profile_url as profile,
      designation as role
    FROM employees_details 
    WHERE team_head = 1 
    AND designation IN ('Software Developer', 'UI/UX', '3D')
    AND working_status = 'Active'`;

    const teamHeads = await queryWithRetry(teamHeadsQuery);
    const teamHeadMap = new Map(teamHeads.map((head) => [head.role, head]));

    // Get all employees for task assignment mapping
    const employeeMap = await getEmployeesFromMySQL();

    const tasksByProject = allTasks.reduce((acc, task) => {
      const projectId = task.projectId.toString();
      if (!acc[projectId]) acc[projectId] = [];
      acc[projectId].push(task);
      return acc;
    }, {});

    // Helper function to calculate project stats for a specific department
    const calculateProjectStats = (project, allTasksForProject, department) => {
      let currentDate = new Date();

      if (project.status === "Hold" || project.status === "Canceled") {
        currentDate = new Date(
          project.statusHistory[project.statusHistory.length - 1].createdAt
        );
      } else {
        currentDate.setHours(0, 0, 0, 0);
      }

      let totalCount = 0;
      let completedCount = 0;
      let delayedCount = 0;
      let overdueCount = 0;
      const projectEmployees = [];
      const employeeSet = new Set();
      let projectLastReportDate = null;

      const tasksForDept = department 
        ? allTasksForProject.filter(task => !task.department || task.department === department)
        : allTasksForProject;

      tasksForDept.forEach((task) => {
        const hasActivities =
          task.activities &&
          Array.isArray(task.activities) &&
          task.activities.length > 0;

        if (hasActivities) {
          const activitiesForDept = task.activities.filter(activity => !activity.department || activity.department === department);
          
          activitiesForDept.forEach((activity) => {
            totalCount++;

            if (activity.employee) {
              const emp = employeeMap.get(activity.employee.toString());
              if (emp && !employeeSet.has(emp.id.toString())) {
                employeeSet.add(emp.id.toString());
                projectEmployees.push({
                  id: emp.id,
                  name: emp.name,
                  role: emp.role,
                  profile: emp.profile,
                });
              }
            }

            const activityEndDate = new Date(activity.endDate);
            activityEndDate.setHours(23, 59, 59, 999);
            const holdMs = calculateHoldDuration(activity.statusHistory);
            activityEndDate.setTime(activityEndDate.getTime() + holdMs);

            const latestReport = allReports
              .filter((r) => r.activityId === activity._id.toString())
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

            if (latestReport) {
              const reportDate = new Date(latestReport.createdAt);
              activity.lastReportDate = reportDate;

              if (
                !projectLastReportDate ||
                reportDate > projectLastReportDate
              ) {
                projectLastReportDate = reportDate;
              }
            } else {
              activity.lastReportDate = null;
            }

            if (activity.percentage === 100) {
              completedCount++;

              if (
                latestReport &&
                new Date(latestReport.createdAt) > activityEndDate
              ) {
                delayedCount++;
              }
            } else if (currentDate > activityEndDate) {
              overdueCount++;
            }
          });
        } else {
          totalCount++;

          if (task.employee) {
            const emp = employeeMap.get(task.employee.toString());
            if (emp && !employeeSet.has(emp.id.toString())) {
              employeeSet.add(emp.id.toString());
              projectEmployees.push({
                id: emp.id,
                name: emp.name,
                role: emp.role,
                profile: emp.profile,
              });
            }
          }

          const taskEndDate = new Date(task.endDate);
          taskEndDate.setHours(23, 59, 59, 999);
          const holdMs = calculateHoldDuration(task.statusHistory);
          taskEndDate.setTime(taskEndDate.getTime() + holdMs);

          const latestReport = allReports
            .filter((r) => r.taskId === task._id.toString() && !r.activityId)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

          if (latestReport) {
            const reportDate = new Date(latestReport.createdAt);
            task.lastReportDate = reportDate;

            if (!projectLastReportDate || reportDate > projectLastReportDate) {
              projectLastReportDate = reportDate;
            }
          } else {
            task.lastReportDate = null;
          }

          if (task.percentage === 100) {
            completedCount++;

            if (
              latestReport &&
              new Date(latestReport.createdAt) > taskEndDate
            ) {
              delayedCount++;
            }
          } else if (currentDate > taskEndDate) {
            overdueCount++;
          }
        }
      });

      return {
        totalCount,
        completedCount,
        delayedCount,
        overdueCount,
        projectEmployees,
        projectLastReportDate,
        currentDate
      };
    };

    const projectsWithDetails = projectsFromDb.map((project) => {
      const projectPercentage = project.percentage || 0;
      const projectTasks = tasksByProject[project._id.toString()] || [];
      const startDate = project.startDate || null;
      const endDate = getEffectiveDeadline(project);

      const stats = calculateProjectStats(project, projectTasks, null);

      let projectStatus = "Not Started";
      const projectDeadline = getEffectiveDeadline(project);

      if (projectPercentage === 100) {
        const projectTaskIds = projectTasks.map((t) => t._id.toString());
        const reportsForProject = allReports.filter((r) =>
          projectTaskIds.includes(r.taskId)
        );

        const lastReport =
          reportsForProject.length > 0
            ? reportsForProject.reduce((latest, current) =>
                new Date(current.createdAt) > new Date(latest.createdAt)
                  ? current
                  : latest
              )
            : null;

        const actualCompletionDate = lastReport
          ? new Date(lastReport.createdAt)
          : null;

        if (
          projectDeadline &&
          actualCompletionDate &&
          actualCompletionDate > projectDeadline
        ) {
          projectStatus = "Delayed";
        } else {
          projectStatus = "Completed";
        }
      } else {
        if (projectDeadline && stats.currentDate > projectDeadline) {
          projectStatus = "Overdue";
        } else if (projectPercentage > 0 && stats.currentDate < projectDeadline) {
          projectStatus = "In Progress";
        } else if (
          projectPercentage === 0 &&
          projectDeadline &&
          stats.currentDate < projectDeadline
        ) {
          projectStatus = "Not Started";
        } else {
          projectStatus = "In Progress";
        }
      }

      return {
        id: project._id,
        projectName: project.projectName || "Unknown Project",
        department: project.department || [],
        startDate: startDate,
        endDate: endDate,
        progress: `${stats.completedCount}/${stats.totalCount}`,
        totalTasks: stats.totalCount,
        completedTasks: stats.completedCount,
        delayedTasks: stats.delayedCount,
        overdueTasks: stats.overdueCount,
        ongoingTasks: stats.totalCount - stats.completedCount - stats.overdueCount,
        status: projectStatus,
        percentage: projectPercentage,
        teamMembers: stats.projectEmployees,
        lastReportDate: stats.projectLastReportDate,
        mainStatus: project.status,
        statusHistory: project.statusHistory || [],
        projectTasks: projectTasks
      };
    });

    const activeProjects = projectsWithDetails.filter((p) => p.totalTasks >= 0);

    // Department ID to name mapping
    const departmentIdMap = {
      '1': 'Software Developer',
      '2': 'UI/UX',
      '3': '3D'
    };

    // Expand projects to appear in all their assigned departments with department-specific stats
    const expandedProjects = [];
    activeProjects.forEach((project) => {
      // Handle department field that could be array or string
      let deptArray = Array.isArray(project.department) 
        ? project.department 
        : [project.department];
      
      // Convert department IDs to names
      const departmentNames = deptArray.map(dept => departmentIdMap[dept] || dept);
      
      // Create an entry for each department this project belongs to with department-specific stats
      departmentNames.forEach((dept) => {
        // Recalculate stats for this specific department
        const deptStats = calculateProjectStats(
          projectsFromDb.find(p => p._id.toString() === project.id.toString()),
          project.projectTasks,
          dept
        );

        expandedProjects.push({
          ...project,
          department: dept,
          totalTasks: deptStats.totalCount,
          completedTasks: deptStats.completedCount,
          delayedTasks: deptStats.delayedCount,
          overdueTasks: deptStats.overdueCount,
          ongoingTasks: deptStats.totalCount - deptStats.completedCount - deptStats.overdueCount,
          progress: `${deptStats.completedCount}/${deptStats.totalCount}`,
          teamMembers: deptStats.projectEmployees,
          lastReportDate: deptStats.projectLastReportDate
        });
      });
    });

    // Group projects by department
    const departmentGroups = new Map();
    const departments = ["Software Developer", "UI/UX", "3D"];

    departments.forEach((dept) => {
      const teamHead = teamHeadMap.get(dept);
      if (teamHead) {
        departmentGroups.set(dept, {
          department: dept,
          teamHead: {
            id: teamHead.id,
            name: teamHead.name,
            profile: teamHead.profile,
            role: teamHead.role,
          },
          projects: [],
          summary: {
            totalProjects: 0,
            completedProjects: 0,
            ongoingProjects: 0,
            overdueProjects: 0,
            delayedProjects: 0,
          },
        });
      }
    });

    // Assign projects to departments
    expandedProjects.forEach((project) => {
      const dept = project.department;
      if (departmentGroups.has(dept)) {
        const deptGroup = departmentGroups.get(dept);
        deptGroup.projects.push({
          id: project.id,
          projectName: project.projectName,
          startDate: project.startDate,
          endDate: project.endDate,
          progress: project.progress,
          totalTasks: project.totalTasks,
          completedTasks: project.completedTasks,
          delayedTasks: project.delayedTasks,
          overdueTasks: project.overdueTasks,
          ongoingTasks: project.ongoingTasks,
          status: project.status,
          percentage: project.percentage,
          teamMembers: project.teamMembers,
          lastReportDate: project.lastReportDate,
          mainStatus: project.mainStatus,
          statusHistory: project.statusHistory || [],
        });

        // Update summary
        deptGroup.summary.totalProjects++;
        if (project.status === "Completed") deptGroup.summary.completedProjects++;
        if (project.status === "In Progress") deptGroup.summary.ongoingProjects++;
        if (project.status === "Overdue") deptGroup.summary.overdueProjects++;
        if (project.status === "Delayed") deptGroup.summary.delayedProjects++;
      }
    });

    const departmentData = Array.from(departmentGroups.values());

    const overallSummary = {
      totalProjects: activeProjects.length,
      totalDepartments: departmentData.length,
      completedProjects: activeProjects.filter((p) => p.status === "Completed").length,
      ongoingProjects: activeProjects.filter((p) => p.status === "In Progress").length,
      overdueProjects: activeProjects.filter((p) => p.status === "Overdue").length,
      delayedProjects: activeProjects.filter((p) => p.status === "Delayed").length,
    };

    res.json({
      success: true,
      data: {
        departments: departmentData,
        projects: activeProjects,
        summary: overallSummary,
      },
    });
  } catch (error) {
    console.error("Error fetching team members project data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team members project data",
      error: error.message,
    });
  }
});

router.get("/employee-tasks", async (req, res) => {
  try {
    const { employeeId, period, projectId, startDate, endDate } = req.query;

    const now = new Date();
    const currentDate = new Date(
      now.toLocaleString("en-US", {
        timeZone: "Asia/Kolkata",
      })
    );

    let queryStartDate = null;
    let queryEndDate = null;

    if (startDate && endDate) {
      queryStartDate = new Date(startDate);
      queryEndDate = new Date(endDate);
    } else if (period && period !== "All") {
      queryStartDate = new Date();
      switch (period) {
        case "Weekly":
          queryStartDate.setDate(currentDate.getDate() - 7);
          break;
        case "Monthly":
          queryStartDate.setMonth(currentDate.getMonth() - 1);
          break;
        case "Yearly":
          queryStartDate.setFullYear(currentDate.getFullYear() - 1);
          break;
      }
      queryEndDate = currentDate;
    }

    const taskQuery = {};
    if (projectId && projectId !== "all") {
      taskQuery.projectId = projectId;
    }

    if (queryStartDate && queryEndDate) {
      taskQuery.$or = [
        {
          createdAt: {
            $gte: queryStartDate,
            $lte: queryEndDate,
          },
        },
        {
          startDate: {
            $gte: queryStartDate,
            $lte: queryEndDate,
          },
        },
        {
          endDate: {
            $gte: queryStartDate,
            $lte: queryEndDate,
          },
        },
      ];
    }

    const [
      allTasks,
      allProjects,
      allReports,
      allDayReports,
    ] = await Promise.all([
      Tasks.find(taskQuery).sort({ createdAt: -1 }).lean(),
      Project_Details.find().sort({ createdAt: -1 }).lean(),
      TaskReports.find().sort({ createdAt: -1 }).lean(),
      DayReport.find().sort({ createdAt: 1 }).lean(),
    ]);

    const employeeMap = await getEmployeesFromMySQL();
    const projectMap = new Map(allProjects.map((p) => [p._id.toString(), p]));

    const employeeOnlyIds = new Set(
      Array.from(employeeMap.keys())
    );

    const projectsData = [];
    const projectTasksMap = new Map();

    allTasks.forEach((task) => {
      const projectIdStr = task.projectId.toString();
      if (!projectTasksMap.has(projectIdStr)) {
        projectTasksMap.set(projectIdStr, []);
      }
      projectTasksMap.get(projectIdStr).push(task);
    });

    for (const [projId, tasks] of projectTasksMap) {
      const project = projectMap.get(projId);
      if (!project) continue;

      let effectiveCurrentDate = currentDate;
      let frozenStatusTimestamp = null;

      if (["Hold", "Canceled"].includes(project.status)) {
        if (project.statusHistory && project.statusHistory.length > 0) {
          const statusEntry = project.statusHistory
            .slice()
            .reverse()
            .find((entry) => entry.status === project.status);

          if (statusEntry && statusEntry.createdAt) {
            effectiveCurrentDate = new Date(statusEntry.createdAt);
            frozenStatusTimestamp = effectiveCurrentDate;
          }
        }
      }

      const projectTasks = [];
      let totalRows = 0;

      for (const task of tasks) {
        const hasActivities = task.activities && task.activities.length > 0;

        if (hasActivities) {
          const activities = [];

          for (const activity of task.activities) {
            if (
              !activity.employee ||
              !employeeOnlyIds.has(activity.employee.toString())
            ) {
              continue;
            }

            if (employeeId && activity.employee?.toString() !== employeeId) {
              continue;
            }

            if (queryStartDate && queryEndDate) {
              const activityDate = new Date(
                activity.createdAt || activity.startDate
              );
              if (
                activityDate < queryStartDate ||
                activityDate > queryEndDate
              ) {
                continue;
              }
            }

            const activityEmployee = employeeMap.get(
              activity.employee?.toString()
            );

            const taskCreator = employeeMap.get(task.employeeID?.toString());

            const activityDayReports = allDayReports.filter(
              (dr) => dr.activityId === activity._id.toString()
            );

            const actualStartDate =
              activityDayReports.length > 0
                ? activityDayReports[0].createdAt
                : null;

            const { status, latestReportDate, effectiveEndDate } = getTaskStatus(
              activity,
              allReports,
              effectiveCurrentDate,
              actualStartDate,
              true
            );

            activities.push({
              activityId: activity._id,
              activityName: activity.activityName,
              assignedTo: {
                name: activityEmployee?.name || "Unassigned",
                profile: activityEmployee?.profile || "",
                role: activityEmployee?.role || "Employee",
              },
              assignedBy: {
                name: taskCreator?.name || "Unknown",
                profile: taskCreator?.profile || "",
                role: taskCreator?.role || "Unknown",
              },
              createdAt: activity.createdAt || task.createdAt,
              startDate: activity.startDate,
              startTime: activity.startTime,
              endTime: activity.endTime,
              endDate: effectiveEndDate,
              actualStartDate: actualStartDate,
              actualEndDate: latestReportDate,
              status,
              latestReportDate: latestReportDate,
              percentage: activity.percentage || 0,
            });
            totalRows++;
          }

          if (activities.length > 0) {
            projectTasks.push({
              taskId: task._id,
              taskName: task.taskName,
              startDate: task.startDate,
              startTime: task.startTime,
              endDate: task.endDate,
              endTime: task.endTime,
              activities,
            });
          }
        } else {
          if (
            !task.employee ||
            !employeeOnlyIds.has(task.employee.toString())
          ) {
            continue;
          }

          if (employeeId && task.employee?.toString() !== employeeId) {
            continue;
          }

          const taskEmployee = employeeMap.get(task.employee?.toString());
          const taskCreator = employeeMap.get(task.employeeID?.toString());

          const taskDayReports = allDayReports.filter(
            (dr) => dr.taskId === task._id.toString() && !dr.activityId
          );

          const actualStartDate =
            taskDayReports.length > 0 ? taskDayReports[0].createdAt : null;

          const { status, latestReportDate, effectiveEndDate } = getTaskStatus(
            task,
            allReports,
            effectiveCurrentDate,
            actualStartDate,
            false
          );

          projectTasks.push({
            taskId: task._id,
            taskName: task.taskName,
            assignedTo: {
              name: taskEmployee?.name || "Unassigned",
              profile: taskEmployee?.profile || "",
              role: taskEmployee?.role || "Employee",
            },
            assignedBy: {
              name: taskCreator?.name || "Unknown",
              profile: taskCreator?.profile || "",
              role: taskCreator?.role || "Unknown",
            },
            createdAt: task.createdAt,
            startDate: task.startDate,
            startTime: task.startTime,
            endDate: effectiveEndDate,
            endTime: task.endTime,
            actualStartDate: actualStartDate,
            actualEndDate: latestReportDate,
            status,
            latestReportDate: latestReportDate,
            percentage: task.percentage || 0,
            activities: [],
          });
          totalRows++;
        }
      }

      if (projectTasks.length > 0) {
        const projectPercentage = project.percentage || 0;
        let projectStatus = "Not Started";

        let statusDate=null;

        if (project.status === "Hold") {
          projectStatus = "Hold";
          statusDate=project.statusHistory?.[project.statusHistory.length-1].createdAt;
        } else if (project.status === "Canceled") {
          projectStatus = "Canceled";
          statusDate=project.statusHistory?.[project.statusHistory.length-1].createdAt;
        } else {
          const projectDeadline = getEffectiveDeadline(project);

          if (projectPercentage === 100) {
            const projectTaskIds = tasks.map((t) => t._id.toString());
            const reportsForProject = allReports.filter((r) =>
              projectTaskIds.includes(r.taskId)
            );

            const lastReport =
              reportsForProject.length > 0
                ? reportsForProject.reduce((latest, current) =>
                    new Date(current.createdAt) > new Date(latest.createdAt)
                      ? current
                      : latest
                  )
                : null;

            const actualCompletionDate = lastReport
              ? new Date(lastReport.createdAt)
              : null;

            if (
              projectDeadline &&
              actualCompletionDate &&
              actualCompletionDate > projectDeadline
            ) {
              projectStatus = "Delayed";
            } else {
              projectStatus = "Completed";
            }
          } else {
            if (projectDeadline && effectiveCurrentDate > projectDeadline) {
              projectStatus = "Overdue";
            } else if (projectPercentage > 0) {
              projectStatus = "In Progress";
            } else if (
              projectPercentage === 0 &&
              effectiveCurrentDate < projectDeadline
            ) {
              projectStatus = "Not Started";
            } else {
              projectStatus = "In Progress";
            }
          }
        }

        projectsData.push({
          projectId: project._id,
          projectName: project.projectName || "Unknown Project",
          tasks: projectTasks,
          totalRows,
          status: projectStatus,
          stausDate:statusDate,
          statusHistory: project.statusHistory || [],
          frozenAt: frozenStatusTimestamp,
          percentage: projectPercentage,
          projectStartDate: project.startDate || null,
          projectEndDate: project.endDate || null,
          projectCorrectionDays: project.correctionDate || [],
        });
      }
    }

    projectsData.sort((a, b) => a.projectName.localeCompare(b.projectName));

    res.json({
      success: true,
      data: {
        projects: projectsData.slice().reverse(),
        summary: {
          totalProjects: projectsData.length,
          totalTasks: projectsData.reduce((sum, p) => sum + p.tasks.length, 0),
          totalRows: projectsData.reduce((sum, p) => sum + p.totalRows, 0),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching employee tasks:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employee tasks",
      error: error.message,
    });
  }
});

function getTaskStatus(
  item,
  allReports,
  currentDate,
  actualStartDate,
  isActivity = false
) {
  const percentage = Number(item.percentage) || 0;

  const scheduledStartDate = new Date(item.startDate);
  if (item.startTime) {
    const [h = 0, m = 0, s = 0] = item.startTime.split(":").map(Number);
    scheduledStartDate.setHours(h, m, s, 0);
  } else {
    scheduledStartDate.setHours(0, 0, 0, 0);
  }

  const scheduledEndDate = new Date(item.endDate);
  if (item.endTime) {
    const [h = 23, m = 59, s = 59] = item.endTime.split(":").map(Number);
    scheduledEndDate.setHours(h, m, s, 0);
  } else {
    scheduledEndDate.setHours(23, 59, 59, 999);
  }

  const holdMs = calculateHoldDuration(item.statusHistory);
  scheduledEndDate.setTime(scheduledEndDate.getTime() + holdMs);

  if (isNaN(scheduledEndDate.getTime())) {
    return { status: "Invalid Date", latestReportDate: null };
  }

  let status = "Not Started";
  let latestReportDate = null;

  const relatedReports = allReports.filter((r) =>
    isActivity
      ? r.activityId === String(item._id)
      : r.taskId === String(item._id)
  );

  const scheduledDuration = scheduledEndDate - scheduledStartDate;

  if (percentage === 100) {
    status = "Completed";

    if (relatedReports.length > 0) {
      const latestReport = relatedReports.reduce((latest, current) =>
        new Date(current.createdAt) > new Date(latest.createdAt)
          ? current
          : latest
      );

      latestReportDate = latestReport.createdAt;
      const actualEndDate = new Date(latestReportDate);

      const effectiveStartDate = actualStartDate
        ? new Date(actualStartDate)
        : scheduledStartDate;

      const actualDuration = actualEndDate - effectiveStartDate;

      if (actualDuration > scheduledDuration) {
        status = "Delayed";
      }
    }
  } else if (percentage > 0) {
    status = "In Progress";
    
    if (currentDate > scheduledEndDate) {
      status = "Overdue";
    } else if (actualStartDate) {
      const effectiveStartDate = new Date(actualStartDate);
      const currentDuration = currentDate - effectiveStartDate;
      
      if (currentDuration > scheduledDuration) {
        status = "Overdue";
      }
    }
  } else {
    status = currentDate > scheduledEndDate ? "Overdue" : "Not Started";
  }

  return { status, latestReportDate, effectiveEndDate: scheduledEndDate };
}


router.get("/project-access/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;

    let employeeIds = [];

    if (projectId === "all") {
      const allProjects = await Project_Details.find({});

      const allEmployeeIds = new Set();
      allProjects.forEach((project) => {
        project.employees.forEach((id) => {
          allEmployeeIds.add(id.replace(/,$/, ""));
        });
      });

      employeeIds = Array.from(allEmployeeIds);
    } else {
      const project = await Project_Details.findById(projectId);

      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      employeeIds = project.employees.map((id) => id.replace(/,$/, ""));
    }

    // Query MySQL for employee details
    const placeholders = employeeIds.map(() => "?").join(",");
    const query = `SELECT 
      employee_id as id,
      employee_name as name,
      profile_url as profile,
      designation as role
    FROM employees_details 
    WHERE employee_id IN (${placeholders})`;

    const employees = await queryWithRetry(query, employeeIds);

    const formattedEmployees = employees.map((emp) => ({
      id: emp.id,
      name: emp.name,
      profile: emp.profile,
      role: emp.role,
    }));

    res.json({
      success: true,
      data: {
        employees: formattedEmployees,
      },
    });
  } catch (error) {
    console.error("Error fetching project access:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching project access data",
    });
  }
});

router.get("/employee-task-stats", async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    let dateFilter = {};
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);

      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      dateFilter = {
        $or: [
          { createdAt: { $gte: start, $lte: end } },
          { startDate: { $gte: start, $lte: end } },
          { endDate: { $gte: start, $lte: end } },
        ],
      };
    }

    const scheduledTasksQuery = {
      $or: [{ employee: employeeId }, { "activities.employee": employeeId }],
      ...dateFilter,
    };

    const scheduledTasks = await Tasks.find(scheduledTasksQuery).lean();

    let scheduledCount = 0;
    scheduledTasks.forEach((task) => {
      const hasActivities = task.activities && task.activities.length > 0;
      if (hasActivities) {
        scheduledCount += task.activities.filter(
          (act) => act.employee?.toString() === employeeId
        ).length;
      } else if (task.employee?.toString() === employeeId) {
        scheduledCount++;
      }
    });

    console.log(scheduledCount);

    const unscheduledQuery = {
      employeeID: employeeId,
      ...dateFilter,
    };

    const unscheduledCount = await UnscheduledTask.countDocuments(
      unscheduledQuery
    );

    const totalCount = scheduledCount + unscheduledCount;

    res.json({
      success: true,
      data: {
        scheduled: scheduledCount,
        unscheduled: unscheduledCount,
        total: totalCount,
      },
    });
  } catch (error) {
    console.error("Error fetching employee task stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching task statistics",
      error: error.message,
    });
  }
});

module.exports = router;
