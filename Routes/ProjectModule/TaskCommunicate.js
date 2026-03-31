const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");
const {
  TaskCommunicate,
  Project_Details,
  Tasks,
} = require("../../Models/DB_Collections");

const sendDateChangeRequestNotification = (io, employeeId, taskName, projectName, timeline) => {
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
      type: "DATE_CHANGE_REQUEST",
      title: "Date Change Request",
      message: `Date change requested for: ${taskName}`,
      details: {
        taskName,
        projectName,
        currentTimeline: timeline,
      },
      timestamp: new Date().toISOString(),
    };

    io.to(employeeId).emit("date_change_request_notification", {
      data: notificationData,
      receiverIds: [employeeId],
    });

    console.log(`✅ Date change request notification sent to ${employeeId}: ${taskName}`);
  } catch (error) {
    console.error(`❌ Failed to send date change notification to ${employeeId}:`, error.message);
  }
};

const sendDateChangeResponseNotification = (io, employeeId, taskName, projectName, status, adminRemarks, approvedBy) => {
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
      type: "DATE_CHANGE_RESPONSE",
      title: `Date Change Request ${status === "approved" ? "Approved" : "Denied"}`,
      message: `Your date change request for ${taskName} has been ${status}`,
      details: {
        taskName,
        projectName,
        status,
        adminRemarks,
        approvedBy,
      },
      timestamp: new Date().toISOString(),
    };

    io.to(employeeId).emit("date_change_response_notification", {
      data: notificationData,
      receiverIds: [employeeId],
    });

    console.log(`✅ Date change response notification sent to ${employeeId}: ${status.toUpperCase()}`);
  } catch (error) {
    console.error(`❌ Failed to send date change response notification to ${employeeId}:`, error.message);
  }
};

router.get("/", async (req, res) => {
  try {
    const { projectId, taskId, activityId } = req.query;

    const query = { projectId, taskId };
    if (activityId) query.activityId = activityId;

    let communication = await TaskCommunicate.findOne(query);

    if (!communication) {
      return res.status(200).json({
        messages: [],
        dateChangeRequests: [],
      });
    }

    const senderIds = communication.messages.map((m) => m.senderId);
    const updatedByIds = communication.dateChangeRequest.map(
      (r) => r.updatedBy
    );
    const allIds = [
      ...new Set([...senderIds, ...updatedByIds].filter(Boolean)),
    ];

    let employeeMap = {};

    if (allIds.length > 0) {
      const placeholders = allIds.map(() => "?").join(",");
      const employeeQuery = `
        SELECT 
          employee_id as id,
          employee_name as name,
          profile_url as profile,
          designation as department
        FROM employees_details 
        WHERE employee_id IN (${placeholders})
      `;
      
      const employees = await queryWithRetry(employeeQuery, allIds);
      
      employeeMap = Object.fromEntries(
        employees.map((e) => [e.id, e])
      );
    }

    const enrichedMessages = communication.messages.map((msg) => {
      const msgObj = msg.toObject ? msg.toObject() : msg;
      return {
        ...msgObj,
        senderDetails: employeeMap[msg.senderId] || null,
      };
    });

    const enrichedDateRequests = communication.dateChangeRequest.map((req) => {
      const reqObj = req.toObject ? req.toObject() : req;
      return {
        ...reqObj,
        updatedByDetails: employeeMap[req.updatedBy] || null,
      };
    });

    res.status(200).json({
      messages: enrichedMessages,
      dateChangeRequests: enrichedDateRequests,
      data: communication,
    });
  } catch (error) {
    console.error("Error fetching communication:", error);
    res.status(500).json({ message: error.message });
  }
});

router.get("/unread-counts", async (req, res) => {
  try {
    const { projectId, role } = req.query;

    if (!projectId || !role) {
      return res.status(400).json({ message: "Missing projectId or role" });
    }

    const communications = await TaskCommunicate.find({ projectId });

    const counts = communications.map((comm) => {
      const lastReadTime =
        comm.readReceipts?.[role]?.lastReadTime || new Date(0);

      const unreadMessages = comm.messages.filter((msg) => {
        const isFromOtherRole = msg.senderRole !== role;
        const isAfterLastRead = new Date(msg.timestamp) > lastReadTime;
        return isFromOtherRole && isAfterLastRead;
      }).length;

      const requestStatusCount = comm.dateChangeRequest.filter((req) => {
        const hasStatusUpdate =
          req.status === "approved" || req.status === "denied";
        const hasTimestamp = req.updatedAt;
        const isAfterLastRead =
          hasTimestamp && new Date(req.updatedAt) > lastReadTime;

        if (role === "employee") {
          return hasStatusUpdate && isAfterLastRead;
        } else {
          return req.status === "requested";
        }
      }).length;

      return {
        taskId: comm.taskId,
        activityId: comm.activityId,
        unreadMessages,
        requestStatusCount,
        totalCount: unreadMessages + requestStatusCount,
      };
    });

    res.status(200).json({ counts });
  } catch (error) {
    console.error("❌ Error fetching unread counts:", error);
    res.status(500).json({ message: error.message });
  }
});

async function getReceiverIds(projectId, taskId, activityId, receiverRole) {
  try {
    if (receiverRole === "employee") {
      const project = await Project_Details.findOne({ _id: projectId }).lean();

      const adminIds =
        project?.accessGrantedTo?.map((access) => access.employeeId) || [];

      if (project?.employeeID) {
        adminIds.push(project.employeeID);
      }

      return [...new Set(adminIds)];
    } else {
      const task = await Tasks.findOne({ projectId, _id: taskId }).lean();

      if (!task) {
        return [];
      }

      if (activityId && task.activities.length > 0) {
        const activity = task.activities.find(
          (act) => act._id.toString() === activityId,
        );
        return activity?.employee ? [activity.employee] : [];
      } else {
        return task.employee ? [task.employee] : [];
      }
    }
  } catch (error) {
    console.error("Error fetching receiver IDs:", error);
    return [];
  }
}

router.post("/message", async (req, res) => {
  try {
    const {
      projectId,
      taskId,
      activityId,
      employeeID,
      senderId,
      senderRole,
      message,
    } = req.body;

    const query = { projectId, taskId };
    if (activityId) query.activityId = activityId;

    let communication = await TaskCommunicate.findOne(query);

    const newMessage = {
      senderId,
      senderRole,
      message,
      timestamp: new Date(),
    };

    if (!communication) {
      communication = new TaskCommunicate({
        projectId,
        taskId,
        activityId: activityId || null,
        employeeID,
        messages: [newMessage],
        dateChangeRequest: [],
      });
    } else {
      communication.messages.push(newMessage);
    }

    await communication.save();

    const savedMessage =
      communication.messages[communication.messages.length - 1].toObject();

    let senderDetails = null;

    if (senderId) {
      const queryforEmployee = `
            SELECT 
              employee_id as id,
              employee_name as name,
              profile_url as profile,
              designation as department
            FROM employees_details 
            WHERE employee_id = ?
          `;

      const employees = await queryWithRetry(queryforEmployee, [senderId]);

      senderDetails = employees[0];
    }

    const enrichedMessage = {
      ...savedMessage,
      senderDetails,
    };

    const projectDetails = await Project_Details.findById(projectId);

    const io = req.app.get("io");
    const room = `${projectId}-${taskId}${activityId ? `-${activityId}` : ""}`;

    if (io) {
      const emitData = {
        projectId,
        taskId,
        activityId,
        message: enrichedMessage,
      };

      io.to(room).emit("new_message", emitData);

      const receiverRole = senderRole === "admin" ? "employee" : "admin";

      io.to(room).emit("unread_count_update", {
        projectId,
        taskId,
        activityId,
        role: receiverRole,
        message: enrichedMessage,
      });

      const receiverIds = await getReceiverIds(
        projectId,
        taskId,
        activityId,
        senderRole,
      );

      io.emit("system_notification", {
        receiverIds: receiverIds,
        message: enrichedMessage,
        projectName: projectDetails.projectName,
      });
    }

    res.status(200).json({
      message: "Message sent successfully",
      data: enrichedMessage,
    });
  } catch (error) {
    console.error("❌ ERROR in /message:", error);
    res.status(500).json({ message: error.message });
  }
});

router.post("/date-change", async (req, res) => {
  try {
    const {
      projectId,
      taskId,
      activityId,
      employeeID,
      startDate,
      startTime,
      endDate,
      endTime,
      empRemarks,
    } = req.body;

    const query = { projectId, taskId };
    if (activityId) {
      query.activityId = activityId;
    }

    let communication = await TaskCommunicate.findOne(query);

    const newRequest = {
      status: "requested",
      startDate,
      startTime,
      endDate,
      endTime,
      empRemarks,
      adminRemarks: "",
      updatedBy: "",
      updatedTime: "",
    };

    if (!communication) {
      communication = new TaskCommunicate({
        projectId,
        taskId,
        activityId: activityId || null,
        employeeID,
        messages: [],
        dateChangeRequest: [newRequest],
      });
    } else {
      communication.dateChangeRequest.push(newRequest);
    }

    await communication.save();

    const savedRequest =
      communication.dateChangeRequest[
        communication.dateChangeRequest.length - 1
      ];

    const task = await Tasks.findById(taskId).lean();
    const project = await Project_Details.findById(projectId).lean();
    const taskName = task?.taskName || "Unknown Task";
    const projectName = project?.projectName || "Unknown Project";

    const io = req.app.get("io");
    const timeline = `${startDate} ${startTime || "09:30"} to ${endDate} ${endTime || "18:30"}`;
    
    sendDateChangeRequestNotification(
      io,
      employeeID,
      taskName,
      projectName,
      timeline
    );

    const room = `${projectId}-${taskId}${activityId ? `-${activityId}` : ""}`;

    if (io) {
      io.to(room).emit("date_change_request", {
        projectId,
        taskId,
        activityId,
        request: savedRequest,
      });

      io.to(room).emit("request_status_update", {
        projectId,
        taskId,
        activityId,
        role: "admin",
      });
    }

    res.status(200).json({
      message: "Date change request submitted successfully",
      data: savedRequest,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/date-change/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;
    const { projectId, taskId, activityId, status, adminRemarks, updatedBy } =
      req.body;

    const query = { projectId, taskId };
    if (activityId) {
      query.activityId = activityId;
    }

    const communication = await TaskCommunicate.findOne(query);

    if (!communication) {
      return res.status(404).json({ message: "Communication not found" });
    }

    const request = communication.dateChangeRequest.id(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    request.status = status;
    request.adminRemarks = adminRemarks;
    request.updatedBy = updatedBy;
    request.updatedTime = new Date().toISOString();

    await communication.save();

    const task = await Tasks.findById(taskId).lean();
    const project = await Project_Details.findById(projectId).lean();
    const taskName = task?.taskName || "Unknown Task";
    const projectName = project?.projectName || "Unknown Project";
    const employeeID = communication.employeeID;

    const io = req.app.get("io");
    
    sendDateChangeResponseNotification(
      io,
      employeeID,
      taskName,
      projectName,
      status,
      adminRemarks,
      updatedBy
    );

    const room = `${projectId}-${taskId}${activityId ? `-${activityId}` : ""}`;

    if (io) {
      io.to(room).emit("date_change_response", {
        projectId,
        taskId,
        activityId,
        requestId,
        status,
        adminRemarks,
      });

      io.to(room).emit("request_status_update", {
        projectId,
        taskId,
        activityId,
        role: "employee",
      });
    }

    res.status(200).json({
      message: "Request updated successfully",
      data: request,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/read-receipt", async (req, res) => {
  try {
    const { projectId, taskId, activityId, role } = req.body;

    if (!projectId || !taskId || !role) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const findQuery = { projectId, taskId };
    if (activityId) findQuery.activityId = activityId;

    const comm = await TaskCommunicate.findOne(findQuery);

    if (!comm) {
      return res.status(200).json({
        message: "No communication record found",
        readReceipts: null,
      });
    }

    if (
      (!comm.messages || comm.messages.length === 0) &&
      comm.dateChangeRequest.length < 1
    ) {
      return res.status(200).json({
        message: "No messages to mark as read",
        readReceipts: comm.readReceipts,
      });
    }

    const updateField =
      role === "employee"
        ? "readReceipts.employee.lastReadTime"
        : "readReceipts.admin.lastReadTime";

    const updatedComm = await TaskCommunicate.findOneAndUpdate(
      findQuery,
      {
        $set: { [updateField]: new Date() },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    res.status(200).json({
      message: "Read timestamp updated successfully",
      readReceipts: updatedComm.readReceipts,
    });
  } catch (error) {
    console.error("❌ Error updating read receipt:", error);
    res.status(500).json({
      message: "Server error updating read receipt.",
      error: error.message,
    });
  }
});

router.delete("/message/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { projectId, taskId, activityId } = req.body;

    const query = { projectId, taskId };
    if (activityId) query.activityId = activityId;

    const communication = await TaskCommunicate.findOne(query);
    if (!communication) {
      return res.status(404).json({ message: "Communication not found" });
    }

    communication.messages = communication.messages.filter(
      (msg) => msg._id.toString() !== messageId,
    );
    await communication.save();

    const io = req.app.get("io");
    const room = `${projectId}-${taskId}${activityId ? `-${activityId}` : ""}`;

    if (io) {
      io.to(room).emit("message_deleted", {
        projectId,
        taskId,
        activityId,
        messageId,
      });
    }

    res.status(200).json({ message: "Message deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
