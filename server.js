require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const initializeDatabase = require("./dataBase/tables");
const { closePool } = require("./dataBase/connection");
const app = express();

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








process.on('SIGTERM', shutdown);  
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('\n⚠ Shutting down...');
  
  server.close(() => {
    console.log('✓ Server closed');
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
