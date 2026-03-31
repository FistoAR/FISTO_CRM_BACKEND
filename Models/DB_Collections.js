const mongoose = require("mongoose");
const MAX_PROJECT_SIZE_BYTES = 50 * 1024 * 1024;

const correction_date = new mongoose.Schema(
  {
    date: { type: Date, default: "" },
    time: { type: String, default: "" },
    startDate: { type: String, default: "" },
    startTime: { type: String, default: "" },
    remarks: { type: String, default: "" },
    employeeID: { type: String, default: "" },
  },
  { timestamps: true, default: "" },
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["In Progress", "Hold", "Canceled"],
      required: true,
    },
    changedBy: { type: String },
    reason: { type: String },
  },
  { timestamps: true },
);

const Project_details = new mongoose.Schema(
  {
    companyName: { type: String, required: true },
    projectName: { type: String, required: true },
    category: { type: String, required: true },
    department: { type: [String], required: true, default: [] },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    description: { type: String, default: "" },
    employeeID: { type: String, default: "" },
    percentage: { type: Number, default: 0 },
    priority: { type: String, default: "Medium" },
    employees: { type: [String], default: [] },
    accessGrantedTo: [
      {
        employeeId: { type: String, required: true },
        grantedAt: { type: Date, default: Date.now },
      },
    ],
    correctionDate: [correction_date],
    status: {
      type: String,
      enum: ["In Progress", "Hold", "Canceled"],
      default: "In Progress",
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
  },
  { timestamps: true },
);

const Project_request = new mongoose.Schema(
  {
    companyName: { type: String, required: true },
    projectName: { type: String, required: true },
    category: { type: String, required: true },
    department: { type: [String], required: true, default: [] },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
    description: { type: String, default: "" },
    employeeID: { type: String, default: "" },
    status: { type: String, default: "Requested" },
  },
  { timestamps: true },
);

const pointSchema = new mongoose.Schema({
  text: { type: String, default: "" },
  completed: { type: Boolean, default: false },
});

const activitySchema = new mongoose.Schema(
  {
    activityName: { type: String, default: "" },
    department: { type: String, default: "" },
    employee: { type: String, default: "" },
    description: { type: String, default: "" },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },
    percentage: { type: Number, default: 0 },
    points: [pointSchema],
    status: {
      type: String,
      enum: ["In Progress", "Hold", "Cancelled", "Not Started"],
      default: "Not Started",
    },
    statusHistory: {
      type: [
        {
          status: { type: String },
          employeeId: { type: String },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    supportingPersons: { type: [String], default: [] },
  },
  { timestamps: true },
);

const task = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    taskName: { type: String, default: "" },
    employeeID: { type: String, default: "" },
    description: { type: String, default: "" },
    startDate: { type: String, default: "" },
    startTime: { type: String, default: "" },
    endDate: { type: String, default: "" },
    endTime: { type: String, default: "" },
    employee: { type: String, default: "" },
    department: { type: String, default: "" },
    percentage: { type: Number, default: 0 },
    activities: [activitySchema],
    points: [pointSchema],
    status: {
      type: String,
      enum: ["In Progress", "Hold", "Cancelled", "Not Started"],
      default: "Not Started",
    },
    statusHistory: {
      type: [
        {
          status: { type: String },
          employeeId: { type: String },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    supportingPersons: { type: [String], default: [] },
  },
  { timestamps: true },
);

const taskReport = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    taskId: { type: String, default: "" },
    activityId: { type: String, default: null },
    employeeID: { type: String, default: "" },
    percentage: { type: Number, default: 0 },
    outcome: { type: String, default: "" },
    adminRemarks: { type: String, default: "" },
    verifiedBy: { type: String, default: "" },
    verifiedAt: { type: Date, default: "" },
  },
  { timestamps: true },
);

const taskReportReview = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    taskId: { type: String, default: "" },
    activityId: { type: String, default: null },
    employeeID: { type: String, default: "" },
    percentage: { type: Number, default: 0 },
    status: { type: String, default: "" },
    outcome: { type: String, default: "" },
    adminRemarks: { type: String, default: "" },
    verifiedBy: { type: String, default: "" },
    verifiedAt: { type: Date, default: "" },
  },
  { timestamps: true },
);

const dayReport = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    taskId: { type: String, default: "" },
    activityId: { type: String, default: null },
    employeeID: { type: String, default: "" },
  },
  { timestamps: true },
);

const dateChangeRequestSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["denied", "approved", "requested"],
      default: "requested",
    },
    startDate: { type: String, default: "" },
    startTime: { type: String, default: "" },
    endDate: { type: String, default: "" },
    endTime: { type: String, default: "" },
    empRemarks: { type: String, default: "" },
    adminRemarks: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    updatedTime: { type: String, default: "" },
  },
  { timestamps: true },
);

const taskCommunicate = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    taskId: { type: String, default: "" },
    activityId: { type: String, default: null },
    employeeID: { type: String, default: "" },

    messages: [
      {
        senderId: { type: String, required: true },
        senderRole: { type: String, required: true },
        message: { type: String, default: "" },
        timestamp: { type: Date, default: Date.now },
      },
    ],

    dateChangeRequest: [dateChangeRequestSchema],

    readReceipts: {
      type: Object,
      default: {
        employee: { lastReadTime: null },
        admin: { lastReadTime: null },
      },
    },
  },
  { timestamps: true },
);

const unscheduledTask = new mongoose.Schema(
  {
    taskName: { type: String, default: "" },
    projectName: { type: String, default: "" },
    reportingPerson: { type: String, default: "" },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },
    reports: { type: String, default: "" },
    outcomes: { type: String, default: "" },
    status: { type: String, default: "In Progress" },
    adminApprovedAt: { type: String, default: "" },
    employeeID: { type: String, default: "" },
  },
  { timestamps: true },
);

const FileSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    filepath: { type: String, required: true },
    size: { type: Number, required: true },
    mimetype: { type: String, default: "" },
  },
  { _id: true },
);

const LinkSchema = new mongoose.Schema(
  {
    linkname: { type: String, required: true },
    linkurl: { type: String, required: true },
  },
  { _id: true },
);

const MeetDocumentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    filepath: { type: String, required: true },
    size: { type: Number, required: true },
    mimetype: { type: String, default: "" },
  },
  { _id: true },
);

const OurAttendeeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    department: { type: String, default: "" },
  },
  { _id: false },
);

const MeetSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "",
      trim: true,
    },

    mode: {
      type: String,
      required: [true, "Meeting mode is required."],
      enum: {
        values: ["Online", "Client Base", "Our Company"],
        message: "'{VALUE}' is not a valid meeting mode.",
      },
    },

    location: {
      type: String,
      default: "",
      trim: true,
    },

    date: {
      type: Date,
      required: [true, "Meeting date is required."],
    },

    startTime: {
      type: String,
      required: [true, "Start time is required."],
      match: [/^\d{2}:\d{2}$/, "startTime must be in HH:MM format."],
    },

    endTime: {
      type: String,
      required: [true, "End time is required."],
      match: [/^\d{2}:\d{2}$/, "endTime must be in HH:MM format."],
    },

    clientAttendees: {
      type: [String],
    },

    ourAttendees: {
      type: [OurAttendeeSchema],
      default: [],
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    documents: {
      type: [MeetDocumentSchema],
      default: [],
    },

    createdBy: {
      type: String,
      default: "",
    },
  },
  { _id: true, timestamps: true },
);

const ResourcesSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, unique: true },
    employeeID: { type: String, default: "" },

    files: { type: [FileSchema], default: [] },
    links: { type: [LinkSchema], default: [] },
    meets: { type: [MeetSchema], default: [] },

    size: {
      type: Number,
      default: 0,
      max: [MAX_PROJECT_SIZE_BYTES, "Project storage limit of 50MB exceeded."],
    },
  },
  { timestamps: true },
);

const weeklyReportSchema = new mongoose.Schema(
  {
    employeeID: { type: String, default: "" },
    employeeName: { type: String, default: "" },
    designation: { type: String, default: "" },
    files: { type: [FileSchema], default: [] },
    description: { type: String, default: "" },
  },
  { timestamps: true },
);

const projectLink = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    projectName: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    category: { type: String, default: "", trim: true },
    addedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

const fieldSchema = new mongoose.Schema({
  fieldId: { type: String, required: true },
  label: { type: String, default: "" },
  value: { type: String, default: "" },
  type: {
    type: String,
    enum: ["text", "password", "link", "textarea", "number", "email"],
    default: "text",
  },
});

const sectionSchema = new mongoose.Schema({
  sectionId: { type: String, required: true },
  title: { type: String, default: "New Section" },
  fields: [fieldSchema],
});

const containerSchema = new mongoose.Schema({
  containerId: { type: String, required: true },
  companyName: { type: String, default: "New Company" },
  sections: [sectionSchema],
  order: { type: Number, default: 0 },
});

const noteCollectionSchema = new mongoose.Schema(
  {
    containers: [containerSchema],
  },
  { timestamps: true },
);

const driveAccess = new mongoose.Schema(
  {
    folderId: { type: String, required: true, unique: true, index: true },
    folderName: { type: String, default: "" },
    createdBy: { type: String, default: "" },

    // ── NEW: Admin-only visibility toggle ──────────────────────────────────
    // When true, this folder is hidden from non-admin users in sidebar & file list.
    adminOnly: { type: Boolean, default: false },

    // Designation-level grants (e.g. "UI/UX", "3D")
    grantedDesignations: [
      {
        designation: { type: String, required: true },
        grantedBy: { type: String, default: "" },
        grantedAt: { type: Date, default: Date.now },
      },
    ],

    // Individual employee grants
    grantedEmployees: [
      {
        employeeId: { type: String, required: true },
        grantedBy: { type: String, default: "" },
        grantedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

driveAccess.index({ folderId: 1 });

const Project_Details = mongoose.model("Project_details", Project_details);
const Project_Request = mongoose.model("Project_Request", Project_request);
const Tasks = mongoose.model("tasks", task);
const TaskReports = mongoose.model("taskReports", taskReport);
const TaskReportsReview = mongoose.model("taskReportsReview", taskReportReview);
const DayReport = mongoose.model("dayReport", dayReport);
const TaskCommunicate = mongoose.model("task_Communicate", taskCommunicate);
const UnscheduledTask = mongoose.model("UnscheduledTask", unscheduledTask);
const Resources = mongoose.model("Resources", ResourcesSchema);
const WeeklyReports = mongoose.model("WeeklyReports", weeklyReportSchema);
const ProjectLink = mongoose.model("ProjectLink", projectLink);
const OthersResource = mongoose.model("OthersResource", noteCollectionSchema);
const DriveAccess = mongoose.model("DriveAccess", driveAccess);

module.exports = {
  Project_Details,
  Project_Request,
  Tasks,
  TaskReports,
  TaskReportsReview,
  DayReport,
  TaskCommunicate,
  UnscheduledTask,
  Resources,
  WeeklyReports,
  ProjectLink,
  OthersResource,
  DriveAccess
};
