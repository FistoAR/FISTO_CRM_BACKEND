const express = require("express");
const { queryWithRetry } = require("../../dataBase/connection");
const {
  Project_Details,
  Project_Request,
  Tasks,
  DayReport,
  TaskReports,
  TaskReportsReview,
} = require("../../Models/DB_Collections");

const router = express.Router();

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

router.post("/checkEmployeeProgress", async (req, res) => {
  try {
    const { projectId, employeeId } = req.body;

    if (!projectId || !employeeId) {
      return res.status(400).json({
        success: false,
        message: "Project ID and Employee ID are required",
      });
    }

    const project = await Project_Details.findById(projectId).lean();

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const tasksWithEmployee = await Tasks.find({
      projectId: projectId,
      $or: [{ employee: employeeId }, { "activities.employee": employeeId }],
    }).lean();

    if (tasksWithEmployee.length === 0) {
      return res.status(200).json({
        success: true,
        canRemove: true,
        message: "Employee can be removed",
        projectName: project.projectName,
      });
    }

    let hasStartedWork = false;
    let startedWorkDetails = null;

    for (const task of tasksWithEmployee) {
      if (task.employee && task.employee.includes(employeeId)) {
        if (task.percentage > 0) {
          hasStartedWork = true;
          startedWorkDetails = {
            projectName: project.projectName,
            taskName: task.taskName,
            message: `Employee has started work on project: ${project.projectName} | task: ${task.taskName}`,
          };
          break;
        }
      }

      if (task.activities && task.activities.length > 0) {
        for (const activity of task.activities) {
          if (activity.employee === employeeId) {
            const activityPercentage = activity.percentage || 0;

            if (activityPercentage > 0) {
              hasStartedWork = true;
              startedWorkDetails = {
                projectName: project.projectName,
                taskName: task.taskName,
                activityName: activity.activityName,
                message: `Employee has started work on Project: ${project.projectName} | task: ${task.taskName} | Group task: ${activity.activityName}`,
              };
              break;
            }
          }
        }

        if (hasStartedWork) break;
      }
    }

    if (hasStartedWork) {
      return res.status(200).json({
        success: true,
        canRemove: false,
        justAssigned: false,
        message: startedWorkDetails.message,
        projectName: startedWorkDetails.projectName,
        taskName: startedWorkDetails.taskName,
        activityName: startedWorkDetails.activityName,
      });
    }

    const taskNames = tasksWithEmployee.map((t) => t.taskName).join(", ");

    return res.status(200).json({
      success: true,
      canRemove: true,
      justAssigned: true,
      message: `Employee has assigned tasks on project: ${project.projectName} | tasks: ${taskNames}`,
      projectName: project.projectName,
      taskName: taskNames,
    });
  } catch (err) {
    console.error("Error checking employee progress:", err);
    res.status(500).json({
      success: false,
      message: "Failed to check employee progress",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});

router.post("/request", async (req, res) => {
  try {
    const {
      companyName,
      projectName,
      category,
      department,
      startDate,
      endDate,
      description,
      employeeID,
    } = req.body;

    if (!companyName || !projectName || !category || !department?.length) {
      return res.status(400).json({
        success: false,
        message: "companyName, projectName, category, department are required",
      });
    }

    const newRequest = new Project_Request({
      companyName,
      projectName,
      category,
      department,
      startDate,
      endDate,
      description: description || "",
      employeeID: employeeID || "",
      status: "Requested",
    });

    await newRequest.save();

    const employeeQuery = `
      SELECT 
        employee_name as name,
        designation as department
      FROM employees_details
      WHERE employee_id = ?
    `;
    const employeeResult = await queryWithRetry(employeeQuery, [employeeID]);
    const employeeName =
      employeeResult.length > 0 ? employeeResult[0].name : "Unknown";

    const adminQuery = `
      SELECT DISTINCT employee_id as id
      FROM employees_details
      WHERE designation IN ('Admin', 'SBU', 'Project Head')
      AND working_status = 'Active'
    `;
    const adminUsers = await queryWithRetry(adminQuery);

    const io = req.app.get("io");
    if (io && adminUsers.length > 0) {
      const notificationData = {
        type: "project_request",
        title: "New Project Request",
        message: `${employeeName} submitted a new project request`,
        data: {
          requestId: newRequest._id,
          employeeName: employeeName,
          companyName: companyName,
          projectName: projectName,
          category: category,
          startDate: startDate,
          endDate: endDate,
          description: description,
          timestamp: new Date().toISOString(),
        },
        receiverIds: adminUsers.map((u) => u.id),
      };

      adminUsers.forEach((admin) => {
        io.to(admin.id).emit("project_request_submitted", notificationData);
      });

      console.log(
        `📢 Socket.IO: Project request notification sent to ${adminUsers.length} admins`,
      );
    }

    res.status(201).json({
      success: true,
      message: "Project request submitted successfully",
      data: newRequest,
    });
  } catch (err) {
    console.error("Error saving project request:", err);
    res.status(500).json({
      success: false,
      message: "Failed to save project request",
      error: err.message,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const projectData = req.body;

    if (!projectData.accessGrantedTo) {
      projectData.accessGrantedTo = [];
    }

    projectData.percentage = 0;
    projectData.status = "In Progress";
    projectData.employees = [];

    const newProject = new Project_Details(projectData);
    await newProject.save();

    res.status(201).json({
      success: true,
      message: "Project created successfully",
      data: newProject,
    });
  } catch (err) {
    console.error("Error saving project:", err);
    res.status(500).json({
      success: false,
      message: "Failed to save project",
      error: err.message,
    });
  }
});

router.put("/updateEmployees", async (req, res) => {
  try {
    const { projectId, employees } = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Project ID is required",
      });
    }

    if (!employees || !Array.isArray(employees)) {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Employees array is required",
      });
    }

    const employeeIds = employees.map((emp) => emp.id);

    const updatedProject = await Project_Details.findByIdAndUpdate(
      projectId,
      {
        employees: employeeIds,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true },
    )
      .select("-__v")
      .lean();

    if (!updatedProject) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Project not found",
      });
    }

    const placeholders = employeeIds.map(() => "?").join(",");

    const populatedEmployeesQuery = `
        SELECT 
          employee_id AS id,
          employee_name AS name,
          profile_url AS profile,
          designation AS department
        FROM employees_details
        WHERE employee_id IN (${placeholders})
      `;
    const populatedEmployees = await queryWithRetry(
      populatedEmployeesQuery,
      employeeIds,
    );

    updatedProject.employees = populatedEmployees.map((emp) => ({
      id: emp._id,
      name: emp.employeeName,
      profile: emp.profile,
    }));

    res.status(200).json({
      success: true,
      message: "Employees updated successfully",
      data: updatedProject,
    });
  } catch (err) {
    console.error("Error updating employees:", err);

    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Invalid project ID format",
      });
    }

    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to update employees",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});

router.put("/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const updateData = req.body;

    const project = await Project_Details.findByIdAndUpdate(
      projectId,
      { $set: updateData },
      { new: true, runValidators: true },
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Project updated successfully",
      data: project,
    });
  } catch (err) {
    console.error("Error updating project:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update project",
      error: err.message,
    });
  }
});

router.put("/", async (req, res) => {
  try {
    const { employeeID, date, time, startDate, startTime, remarks, projectId } =
      req.body;

    if (!date || !employeeID || !projectId) {
      return res.status(400).json({
        success: false,
        error: "Insufficient details",
      });
    }

    const project = await Project_Details.findById(projectId);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    project.correctionDate.push({
      date,
      time: time || "",
      startDate: startDate,
      startTime: startTime,
      remarks: remarks,
      employeeID,
    });

    await project.save();

    return res.status(200).json({
      success: true,
      message: "Correction date added successfully",
      data: project,
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error occurred",
    });
  }
});

router.get("/autocomplete/company", async (req, res) => {
  try {
    const companies = await Project_Details.distinct("companyName");

    res.status(200).json({
      success: true,
      data: companies.filter(Boolean),
    });
  } catch (error) {
    console.error("Error fetching company names:", error);
    res.status(500).json({ error: "Failed to fetch company names" });
  }
});

router.get("/autocomplete/category", async (req, res) => {
  try {
    const { search } = req.query;

    let query = {};
    if (search) {
      query = { category: { $regex: search, $options: "i" } };
    }

    const categories = await Project_Details.find(query).distinct("category");

    res.status(200).json({
      success: true,
      data: categories.filter(Boolean),
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

router.get("/departments", async (req, res) => {
  try {
    const query = `
      SELECT id, designation as name
      FROM designations 
      WHERE designation NOT IN ('Admin', 'SBU', 'Project Head', 'Maid', 'Digital Marketing & HR', 'Digital Marketing','HR')
      ORDER BY designation ASC
    `;
    const departments = await queryWithRetry(query);

    res.status(200).json({
      success: true,
      data: departments,
    });
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
});

router.get("/teamHeads", async (req, res) => {
  try {
    const query = `
      SELECT 
        employee_id as id,
        employee_name as name,
        designation as department,
        profile_url as profile
      FROM employees_details 
      WHERE team_head = 1
      AND designation IN ('Software Developer', '3D', 'UI/UX')
      AND working_status = 'Active'
      ORDER BY employee_name ASC
    `;
    const teamHeads = await queryWithRetry(query);

    res.status(200).json({
      success: true,
      data: teamHeads,
    });
  } catch (error) {
    console.error("Error fetching team heads:", error);
    res.status(500).json({ error: "Failed to fetch team heads" });
  }
});

router.get("/requests", async (req, res) => {
  try {
    const { employeeID } = req.query;

    let query = {};
    if (employeeID && employeeID !== "" && employeeID !== "null") {
      query.employeeID = employeeID;
    }

    const requests = await Project_Request.find(query)
      .sort({ createdAt: -1 })
      .lean();

    if (requests.length > 0) {
      await Promise.all(
        requests.map(async (request) => {
          const query = `
        SELECT 
          employee_name as name,
          designation as department,
          profile_url as profile
        FROM employees_details
        WHERE employee_id = ?
      `;

          const empName = await queryWithRetry(query, [request.employeeID]);

          request.employeeName =
            empName.length > 0 ? empName[0].name : "Unknown";
        }),
      );
    }

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (err) {
    console.error("Error fetching project requests:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch project requests",
      error: err.message,
    });
  }
});

router.get("/employee-tasks/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const concurrentProjects = await Project_Details.find({
      status: { $nin: ["Hold", "Canceled"] },
    })
      .select("_id")
      .lean();

    const projectIds = concurrentProjects.map((p) => p._id);

    const tasks = await Tasks.find({
      projectId: { $in: projectIds },
      $or: [
        { employee: employeeId },
        { supportingPersons: employeeId },
        { "activities.employee": employeeId },
        { "activities.supportingPersons": employeeId }
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    if (tasks.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        message: "No tasks found for this employee",
      });
    }

    const processedTasks = await Promise.all(
      tasks.map(async (task) => {
        const project = await Project_Details.findById(task.projectId)
          .select("clientId colorCode priority projectName")
          .lean();

        let projectDetails = { ...project };

        const isTaskAssigned = task.employee === employeeId;
        const isTaskSupporting = task.supportingPersons?.includes(employeeId);
        const taskPercentage = task.percentage || 0;

        let taskIsUnderReview = false;
        if (isTaskAssigned || isTaskSupporting) {
          const latestTaskReview = await TaskReportsReview.findOne({
            taskId: task._id,
            activityId: null,
          })
            .sort({ createdAt: -1 })
            .lean();

          if (
            latestTaskReview &&
            latestTaskReview.percentage >= 100 &&
            latestTaskReview.status === "underReview"
          ) {
            taskIsUnderReview = true;
          }
        }

        let assignedActivities = [];
        if (task.activities?.length > 0) {
          assignedActivities = await Promise.all(
            task.activities
              .filter((activity) => activity.employee === employeeId || activity.supportingPersons?.includes(employeeId))
              .map(async (activity) => {
                const latestActivityReview = await TaskReportsReview.findOne({
                  activityId: activity._id,
                })
                  .sort({ createdAt: -1 })
                  .lean();

                const isUnderReview =
                  latestActivityReview &&
                  latestActivityReview.percentage >= 100 &&
                  latestActivityReview.status === "underReview";

                const isActivitySupporting = activity.supportingPersons?.includes(employeeId);

                return {
                  ...activity,
                  isComplete: activity.percentage >= 100,
                  isUnderReview: isUnderReview,
                  isSupporting: isActivitySupporting
                };
              }),
          );

          assignedActivities = assignedActivities.filter(
            (activity) => !activity.isComplete && !activity.isUnderReview,
          );
        }

        const isUserAssignedToTask = isTaskAssigned || isTaskSupporting;

        const shouldIncludeTask =
          (isUserAssignedToTask && taskPercentage < 100 && !taskIsUnderReview) ||
          assignedActivities.length > 0;

        if (!shouldIncludeTask) {
          return null;
        }

        return {
          taskId: task._id,
          taskName: task.taskName,
          taskDescription: task.description,
          taskPercentage: taskPercentage,
          taskStatus: task.status,
          taskBudget: task.budget,
          startDate: task.startDate,
          endDate: task.endDate,
          isTask: isUserAssignedToTask && taskPercentage < 100 && !taskIsUnderReview,
          isSupporting: isTaskSupporting,
          project: {
            projectId: projectDetails._id,
            projectName: projectDetails.projectName,
            colorCode: projectDetails.colorCode,
            priority: projectDetails.priority,
          },
          activities: assignedActivities,
          activityCount: assignedActivities.length,
        };
      }),
    );

    const filteredTasks = processedTasks.filter((task) => task !== null);

    res.status(200).json({
      success: true,
      count: filteredTasks.length,
      data: filteredTasks,
    });
  } catch (err) {
    console.error("Error fetching employee tasks:", err);

    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Invalid employee ID format",
      });
    }

    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to fetch employee tasks",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});

router.get("/employee-day-reports/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const dayReports = await DayReport.find({
      employeeID: employeeId,
      createdAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    }).lean();

    const todayItems = dayReports.map((report) => ({
      taskId: report.taskId,
      activityId: report.activityId,
      projectId: report.projectId,
    }));

    res.status(200).json({
      success: true,
      data: todayItems,
    });
  } catch (err) {
    console.error("Error fetching day reports:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch day reports",
      error: err.message,
    });
  }
});

router.get("/employee-calendar-tasks/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { startDate, endDate } = req.query;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const concurrentProjects = await Project_Details.find()
      .select("_id")
      .lean();

    const projectIds = concurrentProjects.map((p) => p._id);

    let taskQuery = {
      projectId: { $in: projectIds },
      $or: [{ employee: employeeId }, { "activities.employee": employeeId }],
    };

    if (startDate && endDate) {
      taskQuery.$and = [
        {
          $or: [
            {
              startDate: { $lte: new Date(endDate) },
              endDate: { $gte: new Date(startDate) },
            },
            {
              startDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              },
            },
          ],
        },
      ];
    }

    const tasks = await Tasks.find(taskQuery).sort({ createdAt: -1 }).lean();

    if (tasks.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        message: "No tasks found for this employee",
      });
    }

    const processedTasks = await Promise.all(
      tasks.map(async (task) => {
        const project = await Project_Details.findById(task.projectId).lean();

        let projectDetails = { ...project };

        const isTaskAssigned = task.employee?.includes(employeeId);
        const taskPercentage = task.percentage || 0;
        let taskEndDate = new Date(task.endDate);

        if (task.endTime) {
          const [hours, minutes] = task.endTime.split(":");
          taskEndDate.setHours(
            parseInt(hours) || 23,
            parseInt(minutes) || 59,
            59,
            999,
          );
        } else {
          taskEndDate.setHours(23, 59, 59, 999);
        }

        const taskHoldMs = calculateHoldDuration(task.statusHistory);
        taskEndDate.setTime(taskEndDate.getTime() + taskHoldMs);

        const currentDate = new Date();

        let calculatedStatus = "Not Started";

        if (["Hold", "Cancelled"].includes(task.status)) {
          calculatedStatus = task.status;
        } else if (taskPercentage >= 100) {
          const latestReport = await TaskReports.findOne({
            taskId: task._id,
          })
            .sort({ createdAt: -1 })
            .lean();

          if (latestReport) {
            const reportDate = new Date(latestReport.createdAt);

            if (reportDate <= taskEndDate) {
              calculatedStatus = "Completed";
              completionInfo = {
                status: "ON_TIME",
                completedDate: latestReport.createdAt,
                daysEarly: Math.floor(
                  (taskEndDate - reportDate) / (1000 * 60 * 60 * 24),
                ),
              };
            } else {
              calculatedStatus = "Completed";
              completionInfo = {
                status: "DELAYED",
                completedDate: latestReport.createdAt,
                daysLate: Math.floor(
                  (reportDate - taskEndDate) / (1000 * 60 * 60 * 24),
                ),
              };
            }
          } else {
            calculatedStatus = "Completed";
          }
        } else if (currentDate > taskEndDate && taskPercentage < 100) {
          calculatedStatus = "Overdue";
        } else if (taskPercentage > 0 && currentDate <= taskEndDate) {
          calculatedStatus = "In Progress";
        } else if (taskPercentage === 0 && currentDate <= taskEndDate) {
          calculatedStatus = "Not Started";
        }

        let assignedActivities = [];
        if (task.activities?.length > 0) {
          assignedActivities = await Promise.all(
            task.activities
              .filter((activity) => activity.employee === employeeId)
              .map(async (activity) => {
                let activityEndDate = new Date(activity.endDate);

                if (activity.endTime) {
                  const [hours, minutes] = activity.endTime.split(":");
                  activityEndDate.setHours(
                    parseInt(hours) || 23,
                    parseInt(minutes) || 59,
                    59,
                    999,
                  );
                } else {
                  activityEndDate.setHours(23, 59, 59, 999);
                }

                const activityHoldMs = calculateHoldDuration(activity.statusHistory);
                activityEndDate.setTime(activityEndDate.getTime() + activityHoldMs);

                const activityPercentage = activity.percentage || 0;
                let activityStatus = "Not Started";

                if (["Hold", "Cancelled"].includes(activity.status)) {
                  activityStatus = activity.status;
                } else if (activityPercentage >= 100) {
                  const latestActivityReport = await TaskReports.findOne({
                    taskId: task._id,
                    activityId: activity._id,
                  })
                    .sort({ createdAt: -1 })
                    .lean();

                  if (latestActivityReport) {
                    const reportDate = new Date(latestActivityReport.createdAt);

                    if (reportDate <= activityEndDate) {
                      activityStatus = "Completed";
                      activityCompletionInfo = {
                        status: "ON_TIME",
                        completedDate: latestActivityReport.createdAt,
                        daysEarly: Math.floor(
                          (activityEndDate - reportDate) /
                          (1000 * 60 * 60 * 24),
                        ),
                      };
                    } else {
                      activityStatus = "Completed";
                      activityCompletionInfo = {
                        status: "DELAYED",
                        completedDate: latestActivityReport.createdAt,
                        daysLate: Math.floor(
                          (reportDate - activityEndDate) /
                          (1000 * 60 * 60 * 24),
                        ),
                      };
                    }
                  } else {
                    activityStatus = "Completed";
                  }
                } else if (
                  currentDate > activityEndDate &&
                  activityPercentage < 100
                ) {
                  activityStatus = "Overdue";
                } else if (
                  activityPercentage > 0 &&
                  currentDate <= activityEndDate
                ) {
                  activityStatus = "In Progress";
                } else if (
                  activityPercentage === 0 &&
                  currentDate <= activityEndDate
                ) {
                  activityStatus = "Not Started";
                }

                return {
                  ...activity,
                  isComplete: activityPercentage >= 100,
                  calculatedStatus: activityStatus,
                  completionInfo: activityCompletionInfo,
                  endDate: activityEndDate,
                };
              }),
          );
        }

        return {
          taskId: task._id,
          taskName: task.taskName,
          taskDescription: task.description,
          taskPercentage: taskPercentage,
          taskStatus: calculatedStatus,
          startDate: task.startDate,
          endDate: taskEndDate,
          isTask: isTaskAssigned,
          isComplete: taskPercentage >= 100,
          completionInfo: completionInfo,
          project: {
            projectId: projectDetails._id,
            projectName: projectDetails.projectName,
            colorCode: projectDetails.colorCode,
            priority: projectDetails.priority,
          },
          activities: assignedActivities,
          activityCount: assignedActivities.length,
        };
      }),
    );

    const filteredTasks = processedTasks.filter((task) => task !== null);

    res.status(200).json({
      success: true,
      count: filteredTasks.length,
      data: filteredTasks,
    });
  } catch (err) {
    console.error("Error fetching employee calendar tasks:", err);

    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Invalid employee ID format",
      });
    }

    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to fetch employee calendar tasks",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});

router.get("/working-projects", async (req, res) => {
  try {
    const { employeeId } = req.query;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let query = {
      createdAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    };

    if (employeeId) {
      query.employeeID = employeeId;
    }

    const dayReports = await DayReport.find(query).select("projectId").lean();

    const projectIds = [
      ...new Set(dayReports.map((report) => report.projectId)),
    ];

    res.status(200).json({
      success: true,
      count: projectIds.length,
      data: projectIds,
    });
  } catch (err) {
    console.error("Error fetching working projects:", err);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to fetch working projects",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});

router.get("/:projectId", async (req, res) => {
  try {
    let project = await Project_Details.findById(req.params.projectId)
      .select("-__v")
      .lean();

    if (!project) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Project not found",
      });
    }

    const originalEmployeeIds = project.employees ? [...project.employees] : [];

    let creator = null;
    if (project.employeeID) {
      const query = `
        SELECT 
          employee_id as id,
          employee_name as name,
          profile_url as profile,
          designation as department
        FROM employees_details 
        WHERE employee_id = ?
      `;
      const employees = await queryWithRetry(query, [project.employeeID]);
      if (employees.length > 0) {
        creator = employees[0];
        project.creator = creator;
      }
    }

    if (project.department && project.department.length > 0) {
      const deptPlaceholders = project.department.map(() => "?").join(",");
      const deptQuery = `
        SELECT id, designation as name
        FROM designations 
        WHERE id IN (${deptPlaceholders})
      `;
      const departments = await queryWithRetry(deptQuery, project.department);
      project.departmentDetails = departments;
    }

    if (!project.department || !project.department.length) {
      project.allEmployees = [];
    } else {
      const deptPlaceholders = project.department.map(() => "?").join(",");

      const employeesByDeptQuery = `
        SELECT 
          e.employee_id AS id,
          e.employee_name AS name,
          e.profile_url AS profile,
          d.designation AS department
        FROM employees_details e
        JOIN designations d 
          ON e.designation = d.designation
        WHERE d.id IN (${deptPlaceholders})
        AND e.working_status = 'Active'
      `;

      const allEmployees = await queryWithRetry(
        employeesByDeptQuery,
        project.department,
      );

      if (allEmployees?.length > 0) {
        project.allEmployees = allEmployees.map((e) => ({
          id: e.id,
          name: e.name,
          profile: e.profile,
          department: e.department,
        }));
      }
    }

    if (originalEmployeeIds.length > 0 && project.allEmployees) {
      const enrichedEmployees = originalEmployeeIds
        .map((empId) =>
          project.allEmployees.find(
            (e) => e.id.toString() === empId.toString(),
          ),
        )
        .filter(Boolean);
      project.employees = enrichedEmployees;
    }

    const allProjectEmployeeIds = [];

    if (project.accessGrantedTo && project.accessGrantedTo.length > 0) {
      project.accessGrantedTo.forEach((item) => {
        if (item.employeeId) {
          allProjectEmployeeIds.push(item.employeeId);
        }
      });
    }

    if (originalEmployeeIds.length > 0) {
      originalEmployeeIds.forEach((empId) => {
        allProjectEmployeeIds.push(empId.toString());
      });
    }

    const uniqueProjectEmployeeIds = [...new Set(allProjectEmployeeIds)];

    if (uniqueProjectEmployeeIds.length > 0) {
      const placeholders = uniqueProjectEmployeeIds.map(() => "?").join(",");
      const teamHeadQuery = `
        SELECT 
          employee_id as id,
          employee_name as name,
          profile_url as profile,
          designation as department
        FROM employees_details 
        WHERE employee_id IN (${placeholders})
        AND team_head = 1
        AND working_status = 'Active'
      `;
      const teamHeadResult = await queryWithRetry(
        teamHeadQuery,
        uniqueProjectEmployeeIds,
      );

      if (teamHeadResult.length > 0) {
        project.teamHead = teamHeadResult;
      } else {
        project.teamHead = creator;
      }
    } else {
      project.teamHead = creator;
    }

    const allTeamHeadsQuery = `
      SELECT 
        employee_id as id,
        employee_name as name,
        profile_url as profile,
        designation as department
      FROM employees_details 
      WHERE team_head = 1
      AND designation IN ('Software Developer', '3D', 'UI/UX')
      AND working_status = 'Active'
    `;
    const teamHeads = await queryWithRetry(allTeamHeadsQuery);
    project.teamHeads = teamHeads;

    const tasks = await Tasks.find({ projectId: req.params.projectId })
      .sort({ createdAt: -1 })
      .lean();

    if (tasks.length > 0) {
      const tasksWithAssignedBy = await Promise.all(
        tasks.map(async (task) => {
          let assignedBy = null;

          if (task.employeeID) {
            const empQuery = `
                  SELECT 
                    employee_id as id,
                    employee_name as name,
                    profile_url as profile
                  FROM employees_details 
                  WHERE employee_id = ?
                `;
            const empResult = await queryWithRetry(empQuery, [task.employeeID]);
            if (empResult.length > 0) {
              assignedBy = empResult[0];
            }
          }

          let latestTaskReport = await TaskReportsReview.findOne({
            taskId: task._id,
            activityId: null,
            status: "underReview",
          })
            .sort({ createdAt: -1 })
            .select("createdAt status percentage budget")
            .lean();

          if (!latestTaskReport) {
            latestTaskReport = await TaskReports.findOne({
              taskId: task._id,
              activityId: null,
            })
              .sort({ createdAt: -1 })
              .select("createdAt status budget")
              .lean();
          }

          if (latestTaskReport?.status === "underReview") {
            task.status = "underReview";
            task.percentage = latestTaskReport.percentage ?? task.percentage;
          }

          let activitiesWithReports = task.activities;
          if (task.activities?.length > 0) {
            activitiesWithReports = await Promise.all(
              task.activities.map(async (activity) => {
                let latestActivityReport = await TaskReportsReview.findOne({
                  taskId: task._id,
                  activityId: activity._id,
                  status: "underReview",
                })
                  .sort({ createdAt: -1 })
                  .select("createdAt status percentage budget")
                  .lean();

                if (!latestActivityReport) {
                  latestActivityReport = await TaskReports.findOne({
                    taskId: task._id,
                    activityId: activity._id,
                  })
                    .sort({ createdAt: -1 })
                    .select("createdAt status budget")
                    .lean();
                }

                if (latestActivityReport?.status === "underReview") {
                  activity.status = "underReview";
                  activity.percentage =
                    latestActivityReport.percentage ?? activity.percentage;
                }

                return {
                  ...activity,
                  latestReportDate: latestActivityReport?.createdAt || null,
                };
              }),
            );
          }

          return {
            ...task,
            activities: activitiesWithReports,
            assigned_by: assignedBy,
            latestReportDate: latestTaskReport?.createdAt || null,
          };
        }),
      );

      project.tasks = tasksWithAssignedBy;
    } else {
      project.tasks = null;
    }

    if (project.correctionDate && project.correctionDate.length > 0) {
      const projectTasks = await Tasks.find({ projectId: req.params.projectId })
        .select("createdAt")
        .lean();

      project.correctionDate = project.correctionDate.map((cd) => {
        let cdTime;
        try {
          if (cd.time) {
            const cdDateObj = new Date(cd.date);
            const datePart = cdDateObj.toISOString().split("T")[0];
            cdTime = new Date(`${datePart}T${cd.time}`).getTime();
          } else {
            cdTime = new Date(cd.date).getTime();
          }
        } catch (e) {
          cdTime = new Date(cd.date).getTime();
        }

        const hasNewTask = projectTasks.some(
          (task) => new Date(task.createdAt).getTime() > cdTime,
        );

        return {
          ...cd,
          isDelete: !hasNewTask,
        };
      });
    }

    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (err) {
    console.error("Error fetching project:", err);

    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Invalid project ID format",
      });
    }

    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to fetch project",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const search = req.query.search || "";
    const empID = req.query.empID || null;
    const role = req.query.role || null;

    let searchQuery = {};

    if (
      empID &&
      empID !== "null" &&
      empID !== "" &&
      !["Admin", "SBU", "Project Head"].includes(role)
    ) {
      searchQuery.$or = [
        { employeeID: empID },
        { employees: empID },
        { "accessGrantedTo.employeeId": empID },
      ];
    }

    let projects = await Project_Details.find(searchQuery)
      .sort({ createdAt: -1 })
      .select("-__v")
      .lean();

    if (!projects || projects.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        message: "No projects found",
      });
    }

    const employeeIds = [
      ...new Set(projects.map((p) => p.employeeID).filter(Boolean)),
    ];

    let employeeMap = {};
    if (employeeIds.length > 0) {
      const placeholders = employeeIds.map(() => "?").join(",");
      const query = `
        SELECT 
          employee_id as id,
          employee_name as name,
          profile_url as profile,
          designation as department
        FROM employees_details 
        WHERE employee_id IN (${placeholders})
      `;
      const employees = await queryWithRetry(query, employeeIds);
      employees.forEach((emp) => {
        employeeMap[emp.id] = emp;
      });
    }

    const allDeptIds = [
      ...new Set(projects.flatMap((p) => p.department || []).filter(Boolean)),
    ];

    let deptMap = {};
    if (allDeptIds.length > 0) {
      const deptPlaceholders = allDeptIds.map(() => "?").join(",");
      const deptQuery = `
        SELECT id, designation as name
        FROM designations
        WHERE id IN (${deptPlaceholders})
      `;
      const deptRows = await queryWithRetry(deptQuery, allDeptIds);
      deptRows.forEach((d) => {
        deptMap[d.id] = d.name;
      });
    }

    projects = await Promise.all(
      projects.map(async (proj) => {
        if (proj.employeeID && employeeMap[proj.employeeID]) {
          proj.teamHead = employeeMap[proj.employeeID];
        } else {
          proj.teamHead = { id: null, name: "Unassigned", profile: null };
        }

        if (proj.department && proj.department.length > 0) {
          proj.departmentDetails = proj.department
            .map((dId) =>
              deptMap[dId] ? { id: dId, name: deptMap[dId] } : null,
            )
            .filter(Boolean);
        } else {
          proj.departmentDetails = [];
        }

        const latestProjectReport = await TaskReports.findOne({
          projectId: proj._id,
        })
          .sort({ createdAt: -1 })
          .select("createdAt")
          .lean();

        proj.latestReportDate = latestProjectReport
          ? latestProjectReport.createdAt
          : null;

        const projectTasks = await Tasks.find({ projectId: proj._id })
          .select("_id percentage activities")
          .lean();

        proj.taskCount = projectTasks.length;

        proj.completedTaskCount = projectTasks.filter(
          (t) => (t.percentage || 0) >= 100,
        ).length;

        if (projectTasks.length > 0) {
          const taskIds = projectTasks.map((t) => t._id);

          const underReviewDocs = await TaskReportsReview.find({
            taskId: { $in: taskIds },
            status: "underReview",
          })
            .select("taskId activityId status percentage")
            .lean();

          const uniqueUnderReviewKeys = new Set();
          underReviewDocs.forEach((doc) => {
            const key = `${doc.taskId}_${doc.activityId || "null"}`;
            uniqueUnderReviewKeys.add(key);
          });

          proj.underReviewCount = uniqueUnderReviewKeys.size;
        } else {
          proj.underReviewCount = 0;
        }

        return proj;
      }),
    );

    if (search) {
      projects = projects.filter(
        (proj) =>
          proj.projectName?.toLowerCase().includes(search.toLowerCase()) ||
          proj.companyName?.toLowerCase().includes(search.toLowerCase()),
      );
    }

    res.status(200).json({
      success: true,
      count: projects.length,
      data: projects,
    });
  } catch (err) {
    console.error("Error fetching projects:", err);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: "Failed to fetch projects",
    });
  }
});

router.delete("/removeEmployeeTasks", async (req, res) => {
  try {
    const { projectId, employeeId } = req.body;

    if (!projectId || !employeeId) {
      return res.status(400).json({
        success: false,
        message: "Project ID and Employee ID are required",
      });
    }

    const tasks = await Tasks.find({
      projectId: projectId,
      $or: [{ employee: employeeId }, { "activities.employee": employeeId }],
    });

    let deletedTasks = 0;
    let updatedTasks = 0;

    for (const task of tasks) {
      if (!task.activities || task.activities.length === 0) {
        if (task.employee && task.employee.includes(employeeId)) {
          await Tasks.findByIdAndDelete(task._id);
          await TaskReports.deleteMany({ taskId: task._id });
          deletedTasks++;
        }
      } else {
        const updatedActivities = task.activities.filter(
          (activity) => activity.employee !== employeeId,
        );

        if (updatedActivities.length === 0) {
          await Tasks.findByIdAndDelete(task._id);
          await TaskReports.deleteMany({ taskId: task._id });
          deletedTasks++;
        } else {
          await Tasks.findByIdAndUpdate(task._id, {
            activities: updatedActivities,
            updatedAt: new Date(),
          });

          const removedActivityIds = task.activities
            .filter((activity) => activity.employee === employeeId)
            .map((activity) => activity._id);

          await TaskReports.deleteMany({
            taskId: task._id,
            activityId: { $in: removedActivityIds },
          });

          updatedTasks++;
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Successfully removed employee tasks`,
      data: {
        deletedTasks,
        updatedTasks,
      },
    });
  } catch (err) {
    console.error("Error removing employee tasks:", err);
    res.status(500).json({
      success: false,
      message: "Failed to remove employee tasks",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});

router.delete("/deleteDate", async (req, res) => {
  try {
    const { projectId, correctionId } = req.body;

    if (!projectId || !correctionId) {
      return res.status(400).json({ success: false, message: "Missing IDs" });
    }

    const updatedProject = await Project_Details.findByIdAndUpdate(
      projectId,
      {
        $pull: { correctionDate: { _id: correctionId } },
      },
      { new: true },
    );

    res.json({
      success: true,
      message: "Correction date removed",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/request/:requestId/approve", async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await Project_Request.findById(requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    const updated = await Project_Request.findByIdAndUpdate(
      requestId,
      { $set: { status: "Approved" } },
      { new: true },
    );

    const employeeQuery = `
      SELECT 
        employee_name as name,
        designation as department
      FROM employees_details
      WHERE employee_id = ?
    `;
    const employeeResult = await queryWithRetry(employeeQuery, [
      request.employeeID,
    ]);
    const employeeName =
      employeeResult.length > 0 ? employeeResult[0].name : "Unknown";

    const storedUser = req.headers.authorization;
    let approverName = "Project Head";

    const io = req.app.get("io");
    if (io && request.employeeID) {
      const notificationData = {
        type: "project_request_approved",
        title: "Project Request Approved",
        message: `Your project request for "${request.projectName}" has been approved`,
        data: {
          id: request._id,
          companyName: request.companyName,
          projectName: request.projectName,
          category: request.category,
          approvedBy: approverName,
          timestamp: new Date().toISOString(),
        },
        receiverIds: [request.employeeID],
      };

      io.to(request.employeeID).emit(
        "project_request_approved",
        notificationData,
      );
      console.log(
        `📢 Socket.IO: Project approval notification sent to ${request.employeeID}`,
      );
    }

    res.status(200).json({
      success: true,
      message: "Request marked as Approved",
      data: updated,
    });
  } catch (err) {
    console.error("Error approving request:", err);
    res.status(500).json({
      success: false,
      message: "Failed to approve request",
      error: err.message,
    });
  }
});

router.patch("/request/:requestId/reject", async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await Project_Request.findById(requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    const updated = await Project_Request.findByIdAndUpdate(
      requestId,
      { $set: { status: "Rejected" } },
      { new: true },
    );

    const employeeQuery = `
      SELECT 
        employee_name as name,
        designation as department
      FROM employees_details
      WHERE employee_id = ?
    `;
    const employeeResult = await queryWithRetry(employeeQuery, [
      request.employeeID,
    ]);
    const employeeName =
      employeeResult.length > 0 ? employeeResult[0].name : "Unknown";

    let rejectorName = "Project Head";

    const io = req.app.get("io");
    if (io && request.employeeID) {
      const notificationData = {
        type: "project_request_rejected",
        title: "Project Request Rejected",
        message: `Your project request for "${request.projectName}" has been rejected`,
        data: {
          id: request._id,
          companyName: request.companyName,
          projectName: request.projectName,
          category: request.category,
          rejectedBy: rejectorName,
          timestamp: new Date().toISOString(),
        },
        receiverIds: [request.employeeID],
      };

      io.to(request.employeeID).emit(
        "project_request_rejected",
        notificationData,
      );
    }

    res.status(200).json({
      success: true,
      message: "Request marked as Rejected",
      data: updated,
    });
  } catch (err) {
    console.error("Error rejecting request:", err);
    res.status(500).json({
      success: false,
      message: "Failed to reject request",
      error: err.message,
    });
  }
});

module.exports = router;
