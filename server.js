require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { closePool } = require("./dataBase/connection");
const session = require("express-session");

const app = express();



const server = http.createServer(app);

// Initialize Socket.IO with enhanced configuration
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e6,
});

app.use(
  cors({
    origin: "https://www.fist-o.com",
    credentials: true,
  })
);

// app.use(
//   cors({
//     origin: [
//       "http://localhost:5173",
//       "https://pspc32l5-5173.inc1.devtunnels.ms"
//     ],
//     credentials: true,
//   })
// );

// app.use(
//   cors({
//     origin: "*",
//     credentials: true,
//   })
// );

app.use(
  session({
    secret: "fisto-drive-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,     
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, 
      sameSite: "lax",    
    },
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/Images", express.static(path.join(__dirname, "Images")));

app.set("io", io);

// Socket.IO state maps
const connectedUsers = new Map(); 
const userSockets = new Map(); 
const socketUsers = new Map();
const clientRooms = new Map();
const userSocketMap = new Map(); 

// Socket.IO event handlers
io.on("connection", (socket) => {
  console.log("✅ Socket.IO: Client connected:", socket.id);

  clientRooms.set(socket.id, new Set());

  // FIXED: Combined register event handler
  socket.on("register", (employeeId) => {
    if (!employeeId) return;
    
    // Legacy registration (from first file)
    connectedUsers.set(employeeId, socket.id);
    socket.employeeId = employeeId;
    console.log(
      `👤 Socket.IO: User registered: ${employeeId} (Socket: ${socket.id})`
    );
    console.log(`📊 Socket.IO: Total connected users: ${connectedUsers.size}`);
    
    // New registration (from second file)
    socket.join(employeeId);
    userSocketMap.set(socket.id, employeeId);
    
    // Also add to userSockets for consistency
    if (!userSockets.has(employeeId)) {
      userSockets.set(employeeId, new Set());
    }
    userSockets.get(employeeId).add(socket.id);
  });

  // Register with role support
  socket.on("register_user", ({ userId, role }) => {
    if (!userId) return;
    
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);
    socketUsers.set(socket.id, { userId, role });
    
    socket.join(userId);
    userSocketMap.set(socket.id, userId);
    
    console.log(
      `👤 Socket.IO: User registered with role: ${userId} (Role: ${role}, Socket: ${socket.id})`
    );
  });

  // Calendar room management
  socket.on("join_calendar_room", () => {
    socket.join("calendar_room");
    socket.emit("calendar_room_joined", { success: true, socketId: socket.id });
    console.log(`📅 Socket.IO: User joined calendar room: ${socket.id}`);
  });

  socket.on("leave_calendar_room", () => {
    socket.leave("calendar_room");
    console.log(`📅 Socket.IO: User left calendar room: ${socket.id}`);
  });

  // Task room management
  socket.on("join_task_room", ({ projectId, taskId, activityId }) => {
    const room = `${projectId}-${taskId}${activityId ? `-${activityId}` : ""}`;
    const currentRooms = clientRooms.get(socket.id) || new Set();

    socket.join(room);
    currentRooms.add(room);
    clientRooms.set(socket.id, currentRooms);

    const roomMembers = io.sockets.adapter.rooms.get(room);

    socket.emit("room_joined", {
      room,
      success: true,
      memberCount: roomMembers?.size || 0,
    });
    
    console.log(`📋 Socket.IO: User joined task room: ${room} (Socket: ${socket.id})`);
  });

  socket.on("leave_task_room", ({ projectId, taskId, activityId }) => {
    const room = `${projectId}-${taskId}${activityId ? `-${activityId}` : ""}`;

    socket.leave(room);

    const currentRooms = clientRooms.get(socket.id);
    if (currentRooms) {
      currentRooms.delete(room);
    }
    
    console.log(`📋 Socket.IO: User left task room: ${room} (Socket: ${socket.id})`);
  });

  // Project room management - for real-time task updates
  socket.on("join_project_room", ({ projectId }) => {
    if (!projectId) return;
    
    const room = `project_${projectId}`;
    const currentRooms = clientRooms.get(socket.id) || new Set();

    socket.join(room);
    currentRooms.add(room);
    clientRooms.set(socket.id, currentRooms);

    const roomMembers = io.sockets.adapter.rooms.get(room);

    socket.emit("project_room_joined", {
      room,
      success: true,
      memberCount: roomMembers?.size || 0,
    });
    
    console.log(`🚀 Socket.IO: User joined project room: ${room} (Socket: ${socket.id})`);
  });

  socket.on("leave_project_room", ({ projectId }) => {
    if (!projectId) return;
    
    const room = `project_${projectId}`;

    socket.leave(room);

    const currentRooms = clientRooms.get(socket.id);
    if (currentRooms) {
      currentRooms.delete(room);
    }
    
    console.log(`👋 Socket.IO: User left project room: ${room} (Socket: ${socket.id})`);
  });

  // Ping/pong for connection health
  socket.on("ping", () => {
    socket.emit("pong");
  });

  // Test event
  socket.on("test_emit", (data) => {
    socket.emit("test_response", { received: true, data });
  });

  // Disconnect handler
  socket.on("disconnect", (reason) => {
    console.log(`👋 Socket.IO: Client disconnected: ${socket.id} (Reason: ${reason})`);
    
    // Clean up legacy registration
    if (socket.employeeId) {
      connectedUsers.delete(socket.employeeId);
      console.log(`👋 Socket.IO: User disconnected: ${socket.employeeId}`);
    } else {
      console.log(`👋 Socket.IO: Anonymous user disconnected: ${socket.id}`);
    }

    // Clean up new registration
    const userInfo = socketUsers.get(socket.id);
    if (userInfo) {
      const { userId } = userInfo;
      const userSocketSet = userSockets.get(userId);

      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          userSockets.delete(userId);
        }
      }
      socketUsers.delete(socket.id);
    }

    // Clean up from userSocketMap
    const mappedUserId = userSocketMap.get(socket.id);
    if (mappedUserId) {
      const userSocketSet = userSockets.get(mappedUserId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          userSockets.delete(mappedUserId);
        }
      }
      userSocketMap.delete(socket.id);
    }

    // Clean up rooms
    clientRooms.delete(socket.id);
    
    console.log(`📊 Socket.IO: Total connected users: ${connectedUsers.size}`);
  });

  socket.on("error", (error) => {
    console.error("❌ Socket.IO: Socket error:", error);
  });
});

// Custom emit methods
io.emitToUser = function (userId, event, data) {
  const socketIds = userSockets.get(userId);
  if (socketIds) {
    let emitCount = 0;
    socketIds.forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit(event, data);
        emitCount++;
      }
    });
    console.log(`📤 Socket.IO: Emitted '${event}' to user ${userId} (${emitCount} sockets)`);
    return emitCount;
  }
  return 0;
};

io.emitToUserInRoom = function (userId, room, event, data) {
  const socketIds = userSockets.get(userId);
  if (socketIds) {
    let emitCount = 0;
    socketIds.forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && socket.rooms.has(room)) {
        socket.emit(event, data);
        emitCount++;
      }
    });
    console.log(`📤 Socket.IO: Emitted '${event}' to user ${userId} in room ${room} (${emitCount} sockets)`);
    return emitCount;
  }
  return 0;
};

app.use((req, res, next) => {
  req.io = io;
  req.userSockets = userSockets;
  req.socketUsers = socketUsers;
  next();
});

// Set on app
app.set("io", io);
app.set("userSockets", userSockets);
app.set("socketUsers", socketUsers);

// Set globally
global.io = io;
global.connectedUsers = connectedUsers;

// Your existing routes
const employeeRegisterRoute = require("./Routes/EmployeeManagement/EmployeeRegister");
const employeeDesignationRoute = require("./Routes/EmployeeManagement/EmployeeDesignation");
const loginRoute = require("./Routes/Login/Login");
const AddClient = require("./Routes/Marketing/AddClient");
const Followup = require("./Routes/Marketing/followups");
const marketingResourcesRoute = require("./Routes/Marketing/Resources");
const analyticsRoute = require("./Routes/Marketing/Analytics");
const reportAnalyticsRoute = require("./Routes/Marketing/reportAnalytics");
const attendanceRoute = require("./Routes/Attendance/Attendance");
const employeeRequestsRoute = require("./Routes/EmployeeRequests/EmployeeRequests");
const employeeMobileRequestsRoute = require("./Routes/MobileRequest/MobileRequst");
const hrRoutes = require("./Routes/Marketing/HR");
const salaryCalculationRoute = require("./Routes/Marketing/salaryCalculation");
const projectBudgetRoute = require("./Routes/Management/ProjectBudget");
const companyBudgetRoutes = require("./Routes/Management/CompanyBudget");
const calendarRoute = require("./Routes/Calendar/calendar");
const dailyReportRoute = require("./Routes/Intern/DailyReport");
const internReportsRoute = require("./Routes/ProjectHead/InternReports");
const AddClientManagement = require("./Routes/Management/AddClient");
const ManagementFollowup = require("./Routes/Management/followups");
const notificationRoutes = require("./Routes/Notification/Notification");
const reportsRoutes = require("./Routes/Employees/reports");
const stickyNotesRoute = require("./Routes/StickyNotes");
const workdoneRoute = require("./Routes/ProjectHead/Workdone");
const taskNotificationsRoutes = require('./Routes/Notification/taskNotifications');
const interviewRoutes = require('./Routes/Marketing/Interview');
const quotesRoute = require('./Routes/Marketing/Quotes');
const maidRoutes = require('./Routes/Marketing/Maid');
const marketingTaskAssign = require("./Routes/ProjectHead/marketingTaskRoutes");
const budgetRoutes = require("./Routes/Management/Budget");
const personalRoutes = require('./Routes/Dashboard/Personal');

// Mongo DB routes
const Project_Details = require("./Routes/ProjectModule/ProjectDetails");
const TaskManagement = require("./Routes/ProjectModule/TaskManagement");
const TaskReports = require("./Routes/ProjectModule/TaskReports");
const DayReport = require("./Routes/ProjectModule/DayTask");
const TaskCommunicate = require("./Routes/ProjectModule/TaskCommunicate");
const UnschedulesTask = require("./Routes/ProjectModule/UnscheduledTask");
const Resources = require("./Routes/ProjectModule/Resourses");
const Analytics = require("./Routes/ProjectModule/Analytics/analytics");
const weeklyReportsRoute = require("./Routes/MasterResource/WeeklyReports");
const ProjectLink = require("./Routes/MasterResource/ProjectLink");
const driveRoutes = require("./Routes/Drive/driveRoutes");
const driveAccess = require("./Routes/Drive/Driveaccess");
const OthersResource = require("./Routes/MasterResource/OthersResource");


app.use("/api/employeeRegister", employeeRegisterRoute);
app.use("/api/designations", employeeDesignationRoute);
app.use("/api/login", loginRoute);
app.use("/api/clientAdd", AddClient);
app.use("/api/followups", Followup);
app.use("/api/marketing-resources", marketingResourcesRoute);
app.use("/api/marketing/analytics", analyticsRoute);
app.use("/api/marketing/report-analytics", reportAnalyticsRoute);
app.use("/api/attendance", attendanceRoute);
app.use("/api/employee-requests", employeeRequestsRoute);
app.use("/api/employee-mobile-requests", employeeMobileRequestsRoute);
app.use("/api/hr", hrRoutes);
app.use("/api/salary-calculation", salaryCalculationRoute);
app.use("/api/budget", projectBudgetRoute);
app.use("/api/company-budget", companyBudgetRoutes);
app.use("/api/calendar", calendarRoute);
app.use("/api/daily-report", dailyReportRoute);
app.use("/api/intern-reports", internReportsRoute);
app.use("/api/clientAddManagement", AddClientManagement);
app.use("/api/ManagementFollowups", ManagementFollowup);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/sticky-notes", stickyNotesRoute);
app.use("/api/workdone", workdoneRoute);
app.use('/api/employees', taskNotificationsRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/quotes', quotesRoute);
app.use('/api/maid', maidRoutes);
app.use("/api/marketingTaskAssign", marketingTaskAssign);
app.use("/api/budget", budgetRoutes);
app.use('/api/celebrations', personalRoutes);

// Mongo DB routes
app.use("/api/project", Project_Details);
app.use("/api/tasks", TaskManagement);
app.use("/api/tasksReports", TaskReports);
app.use("/api/dayReport", DayReport);
app.use("/api/taskCommunicate", TaskCommunicate);
app.use("/api/unscheduledTask", UnschedulesTask);
app.use("/api/resources", Resources);
app.use("/api/analytics", Analytics);
app.use("/api/weeklyReports", weeklyReportsRoute);
app.use("/api/projectLinks", ProjectLink);
app.use("/api/drive", driveRoutes);
app.use("/api/drive/access", driveAccess);
app.use("/api/notes", OthersResource);



// Shutdown handlers
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function shutdown() {
  console.log("\n⚠ Shutting down...");

  server.close(() => {
    console.log("✓ Server closed");

    io.close(() => {
      console.log("✓ Socket.IO closed");
    });

    closePool()
      .then(() => {
        console.log("✓ DB closed");
        process.exit(0);
      })
      .catch((err) => {
        console.error("❌ Error closing DB:", err);
        process.exit(1);
      });
  });

  setTimeout(() => {
    console.error("⚠ Forced shutdown");
    process.exit(1);
  }, 10000);
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO ready`);
});