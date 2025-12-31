require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http"); // REQUIRED
const { Server } = require("socket.io"); // REQUIRED
const initializeDatabase = require("./dataBase/tables");
const { closePool } = require("./dataBase/connection");

const app = express();
const server = http.createServer(app); // REQUIRED: Wrap express app

// REQUIRED: Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (or specify your frontend URL)
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // Support both transports
  allowEIO3: true, // Support older clients
});

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/Images", express.static(path.join(__dirname, "Images")));

initializeDatabase();

app.set("io", io);

// Your existing routes...
const employeeRegisterRoute = require("./Routes/EmployeeManagement/EmployeeRegister");
const employeeDesignationRoute = require('./Routes/EmployeeManagement/EmployeeDesignation');
const loginRoute = require('./Routes/Login/Login');
const AddClient = require("./Routes/Marketing/AddClient");
const Followup = require("./Routes/Marketing/followups");
const AddTask = require("./Routes/Marketing/AddTask");
const marketingEmployeeListRoute = require("./Routes/Marketing/EmployeeList");
const reportTasksRoute = require("./Routes/Marketing/ReportTasks");
const marketingResourcesRoute = require('./Routes/Marketing/Resources');
const analyticsRoute = require('./Routes/Marketing/Analytics');
const reportAnalyticsRoute = require('./Routes/Marketing/reportAnalytics');
const attendanceRoute = require('./Routes/Attendance/Attendance');
const employeeRequestsRoute = require('./Routes/EmployeeRequests/EmployeeRequests');
const hrRoutes = require("./Routes/Marketing/HR");
const salaryCalculationRoute = require('./Routes/Marketing/salaryCalculation');
const projectBudgetRoute = require('./Routes/Management/ProjectBudget');
const companyBudgetRoutes = require("./Routes/Management/CompanyBudget");
const calendarRoute = require('./Routes/Calendar/calendar');
const dailyReportRoute = require('./Routes/Intern/DailyReport');
const internReportsRoute = require('./Routes/ProjectHead/InternReports');
const AddClientManagement = require("./Routes/Management/AddClient");
const ManagementFollowup = require("./Routes/Management/followups");
const notificationRoutes = require("./Routes/Notification/Notification");
const projectsRoute = require("./Routes/ProjectHead/AddProject");
const reportsRoutes = require('./Routes/Employees/reports');
const stickyNotesRoute = require("./Routes/StickyNotes");


app.use("/api/employeeRegister", employeeRegisterRoute);
app.use('/api/designations', employeeDesignationRoute);
app.use('/api/login', loginRoute);
app.use("/api/clientAdd", AddClient);
app.use("/api/followups", Followup);
app.use("/api/marketing-tasks", AddTask);
app.use("/api/marketing/employees-list", marketingEmployeeListRoute);
app.use("/api/marketing/report-tasks", reportTasksRoute);
app.use("/api/marketing-resources", marketingResourcesRoute);
app.use("/api/marketing/analytics", analyticsRoute);
app.use("/api/marketing/report-analytics", reportAnalyticsRoute);
app.use("/api/attendance", attendanceRoute);
app.use("/api/employee-requests", employeeRequestsRoute);
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
app.use("/api/projects", projectsRoute);
app.use('/api/reports', reportsRoutes);
app.use("/api/sticky-notes", stickyNotesRoute);




const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log("✅ Socket.IO: Client connected:", socket.id);

  socket.on("register", (employeeId) => {
    connectedUsers.set(employeeId, socket.id);
    socket.employeeId = employeeId;
    console.log(`👤 Socket.IO: User registered: ${employeeId} (Socket: ${socket.id})`);
    console.log(`📊 Socket.IO: Total connected users: ${connectedUsers.size}`);
  });

  socket.on("disconnect", () => {
    if (socket.employeeId) {
      connectedUsers.delete(socket.employeeId);
      console.log(`👋 Socket.IO: User disconnected: ${socket.employeeId}`);
      console.log(`📊 Socket.IO: Total connected users: ${connectedUsers.size}`);
    } else {
      console.log(`👋 Socket.IO: Anonymous user disconnected: ${socket.id}`);
    }
  });

  socket.on("error", (error) => {
    console.error("❌ Socket.IO: Socket error:", error);
  });
});

global.io = io;
global.connectedUsers = connectedUsers;

// Shutdown handlers
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('\n⚠ Shutting down...');

  server.close(() => {
    console.log('✓ Server closed');
    
    // Close all socket connections
    io.close(() => {
      console.log('✓ Socket.IO closed');
    });

    closePool()
      .then(() => {
        console.log('✓ DB closed');
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ Error closing DB:', err);
        process.exit(1);
      });
  });

  setTimeout(() => {
    console.error('⚠ Forced shutdown');
    process.exit(1);
  }, 10000);
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => { 
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO ready for connections`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
});
