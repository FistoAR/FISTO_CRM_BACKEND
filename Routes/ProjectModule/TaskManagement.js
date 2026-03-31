const express = require("express");
const router = express.Router();
const {
  Tasks,
  Project_Details,
  DayReport,
  UnscheduledTask,
  TaskReportsReview
} = require("../../Models/DB_Collections");
const { queryWithRetry } = require("../../dataBase/connection");

const formatDate = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};


function isTimeOverlapping(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

const sendTaskAssignmentNotification = (io, employeeId, taskName, projectName, timeline, taskId) => {

  if (!io) {
    console.warn(`⚠️ Socket.io not available, notification not sent to ${employeeId}`);
    return;
  }

  try {
    if (!employeeId || employeeId.trim() === "") {
      console.warn(`⚠️ Invalid employee ID: ${employeeId}`);
      return;
    }

    const notificationData = {
      type: "TASK_ASSIGNED",
      title: "New Task Assigned",
      message: `You have been assigned to: ${taskName}`,
      details: {
        taskName,
        projectName,
        timeline,
        taskId,
      },
      timestamp: new Date().toISOString(),
    };

    console.log(`🔔 Sending task assignment notification to ${employeeId}:`, notificationData);

    io.to(employeeId).emit("task_assigned", {
      data: notificationData,
      receiverIds: [employeeId],
    });

    console.log(`✅ Task assignment notification sent to ${employeeId}: ${taskName}`);
  } catch (error) {
    console.error(`❌ Failed to send task notification to ${employeeId}:`, error.message);
  }
};

// const checkInternalActivityConflicts = (activities) => {
//   const conflicts = [];

//   for (let i = 0; i < activities.length; i++) {
//     const activity1 = activities[i];

//     if (!activity1.employee || !activity1.startDate || !activity1.endDate) {
//       continue;
//     }

//     const start1Time = activity1.startTime || "09:30";
//     const end1Time = activity1.endTime || "18:30";
//     const start1 = `${activity1.startDate}T${start1Time}`;
//     const end1 = `${activity1.endDate}T${end1Time}`;

//     for (let j = i + 1; j < activities.length; j++) {
//       const activity2 = activities[j];

//       if (!activity2.employee || !activity2.startDate || !activity2.endDate) {
//         continue;
//       }

//       if (activity1.employee === activity2.employee) {
//         const start2Time = activity2.startTime || "09:30";
//         const end2Time = activity2.endTime || "18:30";
//         const start2 = `${activity2.startDate}T${start2Time}`;
//         const end2 = `${activity2.endDate}T${end2Time}`;

//         if (isTimeOverlapping(start1, end1, start2, end2)) {
//           conflicts.push({
//             activity1Index: i,
//             activity2Index: j,
//             activity1Name: activity1.activityName || `Activity ${i + 1}`,
//             activity2Name: activity2.activityName || `Activity ${j + 1}`,
//             employeeId: activity1.employee,
//           });
//         }
//       }
//     }
//   }

//   return conflicts;
// };

const calculateTaskPercentage = (activities) => {
  if (!activities || activities.length === 0) {
    return 0;
  }

  const totalPercentage = activities.reduce((sum, activity) => {
    return sum + (activity.percentage || 0);
  }, 0);

  return Math.round(totalPercentage / activities.length);
};

const updateProjectPercentage = async (projectId) => {
  try {
    const allTasks = await Tasks.find({ projectId }).lean();

    if (!allTasks || allTasks.length === 0) {
      await Project_Details.findByIdAndUpdate(projectId, { percentage: 0 });
      return;
    }

    const totalPercentage = allTasks.reduce((sum, task) => {
      return sum + (task.percentage || 0);
    }, 0);

    const projectPercentage = Math.round(totalPercentage / allTasks.length);

    await Project_Details.findByIdAndUpdate(projectId, {
      percentage: projectPercentage,
    });

    return projectPercentage;
  } catch (error) {
    console.error("Error updating project percentage:", error);
    throw error;
  }
};

router.post("/check-availability", async (req, res) => {
  try {
    const {
      employeeId,
      startDate,
      startTime,
      endDate,
      endTime,
      isActivityReport,
      excludeId,
      projectId,
      projectType,
    } = req.body;

    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({
        available: true,
        conflicts: [],
        message: "Missing required parameters",
      });
    }

    const requestStart = startTime
      ? `${startDate}T${startTime}`
      : `${startDate}T09:30`;
    const requestEnd = endTime ? `${endDate}T${endTime}` : `${endDate}T18:30`;

    if (new Date(requestEnd) <= new Date(requestStart)) {
      return res.json({
        available: false,
        conflicts: [],
        message: "End time must be after start time",
      });
    }

    const query = {
      $or: [{ employee: employeeId }, { "activities.employee": employeeId }],
    };

    let assignedTasks = await Tasks.find(query)
      .select(
        "employee activities projectId taskName startDate endDate startTime endTime percentage"
      )
      .lean();

    if (projectType && projectId) {
      const currentProject = await Project_Details.findById(projectId)
        .select("projectType")
        .lean();

      if (currentProject && currentProject.projectType) {
        const projectsWithSameType = await Project_Details.find({
          projectType: currentProject.projectType,
        })
          .select("_id")
          .lean();

        const projectIds = projectsWithSameType.map((p) => p._id);

        assignedTasks = assignedTasks.filter((task) => {
          const taskProjectId = task.projectId.toString();
          return projectIds.some((id) => id.toString() === taskProjectId);
        });
      }
    }

    const conflicts = [];

    for (const task of assignedTasks) {
      let projectName = null;
      if (task.projectId) {
        const project = await Project_Details.findById(task.projectId)
          .select("projectName companyName description")
          .lean();

        if (project) {
          projectName = project.projectName || "Unknown Project";
        }
      }

      if (
        task.employee &&
        task.employee === employeeId &&
        task.startDate &&
        task.endDate
      ) {
        if (!isActivityReport && excludeId && task._id.toString() === excludeId)
          continue;

        const taskPercentage = task.percentage || 0;
        if (taskPercentage >= 100) continue;

        const taskStart = task.startTime
          ? `${task.startDate}T${task.startTime}`
          : `${task.startDate}T09:30`;
        const taskEnd = task.endTime
          ? `${task.endDate}T${task.endTime}`
          : `${task.endDate}T18:30`;

        if (isTimeOverlapping(requestStart, requestEnd, taskStart, taskEnd)) {
          conflicts.push({
            taskId: task._id,
            taskName: task.taskName || "Unnamed Task",
            projectName: projectName || "Unknown Project",
            startDate: task.startDate,
            startTime: task.startTime || null,
            endDate: task.endDate,
            endTime: task.endTime || null,
            percentage: taskPercentage,
            type: "task",
          });
        }
      }

      if (task.activities && task.activities.length > 0) {
        for (const activity of task.activities) {
          if (
            activity.employee === employeeId &&
            activity.startDate &&
            activity.endDate
          ) {
            if (
              isActivityReport &&
              excludeId &&
              activity._id.toString() === excludeId
            )
              continue;

            const activityPercentage = activity.percentage || 0;
            if (activityPercentage >= 100) continue;

            const activityStart = activity.startTime
              ? `${activity.startDate}T${activity.startTime}`
              : `${activity.startDate}T09:30`;
            const activityEnd = activity.endTime
              ? `${activity.endDate}T${activity.endTime}`
              : `${activity.endDate}T18:30`;

            if (
              isTimeOverlapping(
                requestStart,
                requestEnd,
                activityStart,
                activityEnd
              )
            ) {
              conflicts.push({
                taskId: task._id,
                taskName: task.taskName || "Unnamed Task",
                activityName: activity.activityName,
                projectName: projectName || "Unknown Project",
                startDate: activity.startDate,
                startTime: activity.startTime || null,
                endDate: activity.endDate,
                endTime: activity.endTime || null,
                percentage: activityPercentage,
                type: "activity",
              });
            }
          }
        }
      }
    }

    res.json({
      available: conflicts.length === 0,
      conflicts,
      message:
        conflicts.length > 0
          ? `Employee has ${conflicts.length} conflicting assignment(s)`
          : "Employee is available",
    });
  } catch (error) {
    console.error("Error checking availability:", error);
    res.status(500).json({
      error: "Failed to check availability",
      available: true,
      conflicts: [],
    });
  }
});


router.post("/create", async (req, res) => {
  try {

    const { projectId, tasks } = req.body;

    if (!projectId || !tasks || !Array.isArray(tasks)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request data",
      });
    }

    const validationErrors = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      if (!task.taskName || task.taskName.trim() === "") {
        validationErrors.push(`Task ${i + 1}: Task name is required`);
      }

      if (!task.startDate || !task.endDate) {
        validationErrors.push(
          `Task ${i + 1}: Start and end dates are required`
        );
      }

      if (task.startDate && task.endDate) {
        let taskStart, taskEnd;

        if (task.startTime && task.endTime) {
          taskStart = new Date(`${task.startDate}T${task.startTime}`);
          taskEnd = new Date(`${task.endDate}T${task.endTime}`);
        } else {
          const defaultStartTime = "09:30";
          const defaultEndTime = "18:30";

          taskStart = new Date(
            `${task.startDate}T${task.startTime || defaultStartTime}`
          ).toISOString();
          taskEnd = new Date(
            `${task.endDate}T${task.endTime || defaultEndTime}`
          ).toISOString();
        }

        if (taskEnd <= taskStart) {
          validationErrors.push(
            `Task ${i + 1}: End time must be after start time`
          );
        }

        if (task.activities && task.activities.length > 0) {
          const validActivities = task.activities.filter(
            (act) =>
              act.activityName && act.activityName.trim() !== "" && act.employee
          );

          if (validActivities.length === 0) {
            validationErrors.push(
              `Task ${i + 1}: Activities must have name and employee assigned`
            );
          }

          for (let j = 0; j < task.activities.length; j++) {
            const activity = task.activities[j];

            if (!activity.activityName || activity.activityName.trim() === "") {
              validationErrors.push(
                `Task ${i + 1}, Activity ${j + 1}: Activity name is required`
              );
            }

            if (!activity.employee) {
              validationErrors.push(
                `Task ${i + 1}, Activity ${j + 1}: Employee must be assigned`
              );
            }

            if (
              activity.startDate &&
              activity.startTime &&
              activity.endDate &&
              activity.endTime
            ) {
              const actStart = new Date(
                `${activity.startDate}T${activity.startTime}`
              );
              const actEnd = new Date(
                `${activity.endDate}T${activity.endTime}`
              );

              if (actEnd <= actStart) {
                validationErrors.push(
                  `Task ${i + 1}, Activity ${j + 1
                  }: End time must be after start time`
                );
              }

              if (task.startTime && task.endTime) {
                if (actStart < taskStart || actEnd > taskEnd) {
                  validationErrors.push(
                    `Task ${i + 1}, Activity ${j + 1
                    }: Activity time must be within task time range`
                  );
                }
              }
            }
          }

          // const internalConflicts = checkInternalActivityConflicts(
          //   task.activities
          // );
          // if (internalConflicts.length > 0) {
          //   internalConflicts.forEach((conflict) => {
          //     validationErrors.push(
          //       `Task ${i + 1}: ${conflict.activity1Name} and ${
          //         conflict.activity2Name
          //       } have overlapping times for the same employee`
          //     );
          //   });
          // }
        }
      }

      const hasTaskEmployees = task.employees && task.employees.length > 0;
      const hasActivityEmployees =
        task.activities &&
        task.activities.length > 0 &&
        task.activities.some((act) => act.employee);

      if (hasTaskEmployees && hasActivityEmployees) {
        validationErrors.push(
          `Task ${i + 1
          }: Cannot have both task-level and activity-level employee assignments`
        );
      }

      if (!hasTaskEmployees && !hasActivityEmployees) {
        validationErrors.push(
          `Task ${i + 1
          }: Must assign employees either at task level or through activities`
        );
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: validationErrors,
      });
    }

    const createdTasks = [];

    const project = await Project_Details.findById(projectId).lean();
    const projectName = project?.projectName || "Unknown Project";

    const io = req.app.get("io");

    for (const taskData of tasks) {
      const activities = taskData.activities
        ? taskData.activities.map((activity) => {
            const { _id, ...activityFields } = activity;
            const updatedActivity = { ...activityFields };

            // Only keep _id if it's NOT a temporary string ID
            if (_id && !String(_id).startsWith("temp_")) {
              updatedActivity._id = _id;
            }

            return {
              ...updatedActivity,
              percentage: activity.percentage || 0,
              status: activity.status || "Not Started",
            };
          })
        : [];

      const taskPercentage =
        activities.length > 0 ? calculateTaskPercentage(activities) : 0;

      const task = new Tasks({
        projectId,
        employeeID: taskData.employeeID,
        taskName: taskData.taskName,
        description: taskData.description,
        startDate: taskData.startDate,
        startTime: taskData.startTime || "09:30",
        endDate: taskData.endDate,
        endTime: taskData.endTime || "18:30",
        employee: taskData.employees || "",
        department: taskData.department || "",
        teams: taskData.teams || [],
        activities: activities,
        percentage: taskPercentage,
        points: taskData.points,
        status: "Not Started",
      });

      const savedTask = await task.save();
      createdTasks.push(savedTask);


      const employeesArray = Array.isArray(taskData.employees)
        ? taskData.employees
        : (taskData.employees ? [taskData.employees] : []);

      if (employeesArray.length > 0) {
        const timeline = `${formatDate(taskData.startDate)} to ${formatDate(taskData.endDate)}`;
        for (const employeeId of employeesArray) {
          sendTaskAssignmentNotification(
            io,
            employeeId,
            taskData.taskName,
            projectName,
            timeline,
            savedTask._id
          );
        }
      } else {
        console.log("❌ No task employees to notify");
      }

      if (taskData.activities && Array.isArray(taskData.activities)) {
        console.log("✅ Checking activities for notifications");
        for (const activity of taskData.activities) {
          console.log("🔄 Activity:", activity.activityName, "Employee:", activity.employee);
          if (activity.employee) {
            const timeline = `${formatDate(activity.startDate)} to ${formatDate(activity.endDate)}`;
            sendTaskAssignmentNotification(
              io,
              activity.employee,
              `${taskData.taskName} - ${activity.activityName}`,
              projectName,
              timeline,
              savedTask._id
            );
          }
        }
      } else {
        console.log("❌ No activities to notify");
      }
    }


    await updateProjectPercentage(projectId);

    io.to(`project_${projectId}`).emit("tasks_created", {
      projectId,
      tasksCreated: createdTasks,
      message: `${createdTasks.length} new task(s) created`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      message: `${createdTasks.length} task(s) created successfully`,
      tasks: createdTasks,
    });
  } catch (error) {
    console.error("Error creating tasks:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create tasks",
      error: error.message,
    });
  }
});

router.get("/dashboard", async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [allTasks, unscheduledTask, dayTask] = await Promise.all([
      Tasks.find().lean(),
      UnscheduledTask.find({
        createdAt: { $gte: todayStart, $lte: todayEnd }
      }).lean(),
      DayReport.find({
        createdAt: { $gte: todayStart, $lte: todayEnd }
      }).lean(),
    ]);

    const adminQuery = `
      SELECT *
      FROM employees_details
      WHERE designation NOT IN ('Admin', 'SBU', 'Project Head', 'Maid', 'Digital Marketing & HR', 'Digital Marketing','HR')
      AND working_status = 'Active'
    `;
    const employees = await queryWithRetry(adminQuery);

    // Enrich today's day reports with task/activity/project details
    const enrichedDayTask = await Promise.all(
      dayTask.map(async (day) => {
        let taskDetails = null;
        let activityDetails = null;
        let projectName = "";
        let startDate = "";
        let endDate = "";
        let startTime = "";
        let endTime = "";

        if (day.taskId) {
          const task = await Tasks.findById(day.taskId).lean();
          if (task) {
            taskDetails = {
              taskName: task.taskName,
              description: task.description,
              startDate: task.startDate,
              endDate: task.endDate,
              startTime: task.startTime,
              endTime: task.endTime,
            };

            startDate = task.startDate;
            endDate = task.endDate;
            startTime = task.startTime;
            endTime = task.endTime;

            // If activityId exists → it's an activity report
            if (day.activityId) {
              const activity = task.activities?.find(
                (act) => act._id.toString() === day.activityId.toString()
              );
              if (activity) {
                activityDetails = {
                  activityName: activity.activityName,
                  description: activity.description,
                  startDate: activity.startDate,
                  endDate: activity.endDate,
                  startTime: activity.startTime,
                  endTime: activity.endTime,
                };
                startDate = activity.startDate;
                endDate = activity.endDate;
                startTime = activity.startTime;
                endTime = activity.endTime;
              }
            }

            if (task.projectId) {
              const project = await Project_Details.findById(task.projectId)
                .select("projectName")
                .lean();
              if (project) {
                projectName = project.projectName;
              }
            }
          }
        }

        return {
          ...day,
          taskDetails,
          activityDetails,
          projectName,
          startDate,
          endDate,
          startTime,
          endTime,
        };
      })
    );

    res.json({
      success: true,
      tasks: allTasks,
      unscheduledTask,
      dayTask: enrichedDayTask,
      employees,
    });
  } catch (error) {
    console.error("Error fetching dashboard:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tasks",
      error: error.message,
    });
  }
});


router.get("/", async (req, res) => {
  try {
    const tasks = await Tasks.find().lean();

    const enrichedTasks = await Promise.all(
      tasks.map(async (task) => {
        if (task.projectId) {
          const project = await Project_Details.findById(task.projectId)
            .select("projectName companyName description")
            .lean();
          if (project) {
            task.projectName = project.projectName || "Unknown Project";
            task.companyName = project.companyName || "Unknown Company";
            task.description = project.description || "";
          }
        }
        return task;
      })
    );

    res.json({
      success: true,
      tasks: enrichedTasks,
    });
  } catch (error) {
    console.error("Error fetching all tasks:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tasks",
      error: error.message,
    });
  }
});

router.get("/project/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;

    const tasks = await Tasks.find({ projectId }).lean();
    const reviews = await TaskReportsReview.find({ projectId }).sort({ createdAt: -1 }).lean();

    // Map reviews to a lookup structure { taskId: { taskStatus: String, activities: { activityId: status } } }
    const reviewMap = {};
    reviews.forEach(review => {
      const tid = review.taskId?.toString();
      const aid = review.activityId?.toString();
      
      if (tid) {
        if (!reviewMap[tid]) reviewMap[tid] = { taskStatus: null, activities: {} };
        
        if (aid) {
          if (!reviewMap[tid].activities[aid]) {
            reviewMap[tid].activities[aid] = review.status;
          }
        } else {
          if (!reviewMap[tid].taskStatus) {
            reviewMap[tid].taskStatus = review.status;
          }
        }
      }
    });

    const tasksWithReview = tasks.map(task => {
      const tid = task._id.toString();
      const taskReviewStatus = reviewMap[tid]?.taskStatus || null;
      
      const activitiesWithReview = (task.activities || []).map(act => {
        const aid = act._id.toString();
        return {
          ...act,
          reviewStatus: reviewMap[tid]?.activities[aid] || null
        };
      });

      return {
        ...task,
        reviewStatus: taskReviewStatus,
        activities: activitiesWithReview
      };
    });

    res.json({
      success: true,
      tasks: tasksWithReview,
    });

  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tasks",
      error: error.message,
    });
  }
});

router.put("/:taskId", async (req, res) => {
  try {

    console.log("update")

    const { taskId } = req.params;
    const updateData = req.body;

    const existingTask = await Tasks.findById(taskId);
    if (!existingTask) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (
      updateData.employees &&
      updateData.employees.length > 0 &&
      updateData.activities &&
      updateData.activities.length > 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Task cannot have both task-level employees and activities",
      });
    }

    if (updateData.activities && updateData.activities.length > 0) {
      updateData.activities = updateData.activities.map((activity) => {
        const { _id, ...activityFields } = activity;
        const updatedActivity = { ...activityFields };

        // Only keep _id if it's NOT a temporary string ID
        if (_id && !String(_id).startsWith("temp_")) {
          updatedActivity._id = _id;
        }

        const existingActivity = existingTask.activities.find(
          (a) => a._id.toString() === String(_id)
        );
        const oldStatus = existingActivity
          ? existingActivity.status
          : "Not Started";
        const history =
          existingActivity && existingActivity.statusHistory
            ? [...existingActivity.statusHistory]
            : [];

        if (activity.status && activity.status !== oldStatus) {
          history.push({
            status: activity.status,
            employeeId: updateData.changedBy || "Unknown",
            createdAt: new Date(),
          });
        }
        return { ...updatedActivity, statusHistory: history };
      });

      updateData.percentage = calculateTaskPercentage(updateData.activities);
    }

    if (updateData.status && existingTask.status !== updateData.status) {
      const history = existingTask.statusHistory ? [...existingTask.statusHistory] : [];
      history.push({
        status: updateData.status,
        employeeId: updateData.changedBy || "Unknown",
        createdAt: new Date()
      });
      updateData.statusHistory = history;
    }

    const updatedTask = await Tasks.findByIdAndUpdate(taskId, updateData, {
      new: true,
      runValidators: true,
    });

    // Send notifications for newly added employees
    const io = req.app.get("io");
    const project = await Project_Details.findById(existingTask.projectId).lean();
    const projectName = project?.projectName || "Unknown Project";

    // Notify newly added task-level employees
    // Convert employees to array if it's a string
    const employeesArray = Array.isArray(updateData.employees)
      ? updateData.employees
      : (updateData.employees ? [updateData.employees] : []);

    if (employeesArray.length > 0) {
      const newEmployees = employeesArray.filter(
        (emp) => !existingTask.employee || !existingTask.employee.includes(emp)
      );

      const timeline = `${formatDate(updatedTask.startDate)} to ${formatDate(updatedTask.endDate)}`;
      for (const employeeId of newEmployees) {
        sendTaskAssignmentNotification(
          io,
          employeeId,
          updatedTask.taskName,
          projectName,
          timeline,
          updatedTask._id
        );
      }
    }

    // Notify newly added activities with employees
    if (updateData.activities && Array.isArray(updateData.activities)) {
      for (const activity of updateData.activities) {
        if (activity.employee) {
          const isNewActivity = !existingTask.activities?.some(
            (existingAct) => existingAct._id?.toString() === activity._id?.toString()
          );

          if (isNewActivity) {
            const timeline = `${formatDate(activity.startDate)} to ${formatDate(activity.endDate)}`;
            sendTaskAssignmentNotification(
              io,
              activity.employee,
              `${updatedTask.taskName} - ${activity.activityName}`,
              projectName,
              timeline,
              updatedTask._id
            );
          }
        }
      }
    }

    await updateProjectPercentage(existingTask.projectId);

    // 🔔 Broadcast to all users in the project that task was updated
    console.log(`📢 Broadcasting task_updated event to project room: project_${existingTask.projectId}`);
    io.to(`project_${existingTask.projectId}`).emit("task_updated", {
      projectId: existingTask.projectId,
      taskId: updatedTask._id,
      taskName: updatedTask.taskName,
      message: "Task has been updated",
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Task updated successfully",
      task: updatedTask,
    });
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update task",
      error: error.message,
    });
  }
});

router.delete("/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;

    const deletedTask = await Tasks.findByIdAndDelete(taskId);

    if (!deletedTask) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    await updateProjectPercentage(deletedTask.projectId);

    // 🔔 Broadcast to all users in the project that task was deleted
    console.log(`📢 Broadcasting task_deleted event to project room: project_${deletedTask.projectId}`);
    io.to(`project_${deletedTask.projectId}`).emit("task_deleted", {
      projectId: deletedTask.projectId,
      taskId: deletedTask._id,
      taskName: deletedTask.taskName,
      message: "Task has been deleted",
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Task deleted successfully",
      task: deletedTask,
    });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete task",
      error: error.message,
    });
  }
});


// ─── Update task or activity status ───────────────────────────────────────────
router.patch("/status/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, activityId } = req.body;

    const validStatuses = ["In Progress", "Hold", "Cancelled", "Not Started"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    const task = await Tasks.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    let updatedTask;
    if (activityId) {
      // Update status of a specific activity
      const actIdx = task.activities.findIndex(
        (a) => a._id.toString() === activityId
      );
      if (actIdx === -1) {
        return res.status(404).json({ success: false, message: "Activity not found" });
      }
      task.activities[actIdx].status = status;
      updatedTask = await task.save();
    } else {
      // Update task-level status
      updatedTask = await Tasks.findByIdAndUpdate(
        taskId,
        { status },
        { new: true, runValidators: true }
      );
    }

    // Broadcast update
    const io = req.app.get("io");
    if (io) {
      io.to(`project_${task.projectId}`).emit("task_updated", {
        projectId: task.projectId,
        taskId: updatedTask._id,
        message: "Task status updated",
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: "Status updated successfully", task: updatedTask });
  } catch (error) {
    console.error("Error updating task status:", error);
    res.status(500).json({ success: false, message: "Failed to update status", error: error.message });
  }
});

// ─── Update supporting persons for a task/activity ────────────────────────────
router.patch("/supporting-persons/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { supportingPersons, activityId } = req.body;

    if (!Array.isArray(supportingPersons)) {
      return res.status(400).json({ success: false, message: "supportingPersons must be an array" });
    }

    const task = await Tasks.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    let updatedTask;
    if (activityId) {
      const actIdx = task.activities.findIndex(
        (a) => a._id.toString() === activityId
      );
      if (actIdx === -1) {
        return res.status(404).json({ success: false, message: "Activity not found" });
      }
      task.activities[actIdx].supportingPersons = supportingPersons;
      updatedTask = await task.save();
    } else {
      updatedTask = await Tasks.findByIdAndUpdate(
        taskId,
        { supportingPersons },
        { new: true }
      );
    }

    res.json({ success: true, message: "Supporting persons updated", task: updatedTask });
  } catch (error) {
    console.error("Error updating supporting persons:", error);
    res.status(500).json({ success: false, message: "Failed to update supporting persons", error: error.message });
  }
});

module.exports = router;

