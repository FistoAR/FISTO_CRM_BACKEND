const { queryWithRetry, getConnectionWithRetry } = require("./connection");

async function initializeDatabase() {
  console.log("Initializing database...");

  try {
    await queryWithRetry(
      `CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`
    );
    console.log("✓ Database created/verified");
    await createTables();
  } catch (err) {
    console.error("❌ DB initialization failed:", err.message);
  }
}

async function createTables() {
  let connection;

  try {
    connection = await getConnectionWithRetry();

    const tables = [
      `CREATE TABLE IF NOT EXISTS employees_details (
        id INT AUTO_INCREMENT PRIMARY KEY,  
        employee_id VARCHAR(50),  
        employee_name VARCHAR(50),
        dob DATE,
        gender ENUM('male','female','other'),
        email_personal VARCHAR(50),
        email_official VARCHAR(50),
        phone_personal VARCHAR(30),
        phone_official VARCHAR(30),  
        employment_type ENUM('On Role','Intern'),
        designation VARCHAR(20),
        team_head BOOLEAN DEFAULT FALSE,
        working_status VARCHAR(20),
        join_date DATE,
        intern_start_date DATE,
        intern_end_date DATE,
        duration_months VARCHAR(20),
        address TEXT,
        password VARCHAR(255),        
        profile_url VARCHAR(1024),
        resume_url VARCHAR(1024),
        ID_url JSON,
        Certificates_url JSON,
        otherDocs_url JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );`,

      `CREATE TABLE IF NOT EXISTS ClientsData (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50),
        company_name VARCHAR(50),
        customer_name VARCHAR(50),
        industry_type VARCHAR(50),
        website VARCHAR(100),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(200),
        reference VARCHAR(50),
        requirements TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        active TINYINT(1) DEFAULT 1
      );`,

      `CREATE TABLE IF NOT EXISTS ContactPersons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        clientID INT,
        name VARCHAR(100),
        contactNumber VARCHAR(20),
        email VARCHAR(100),
        designation VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (clientID) REFERENCES ClientsData(id) ON DELETE CASCADE
      );`,

      `
      CREATE TABLE IF NOT EXISTS designations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      designation VARCHAR(255) NOT NULL UNIQUE,
      created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );`,

     `CREATE TABLE IF NOT EXISTS Followups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clientID INT NOT NULL,
      contactPersonID INT,
      status ENUM('first_followup', 'second_followup', 'not_available', 'not_interested', 'not_reachable', 'converted', 'droped') NOT NULL,
      remarks TEXT,
      nextFollowupDate VARCHAR(255),
      shared VARCHAR(10),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (clientID) REFERENCES ClientsData(id) ON DELETE CASCADE,
      FOREIGN KEY (contactPersonID) REFERENCES ContactPersons(id) ON DELETE SET NULL
    );`,

     `CREATE TABLE IF NOT EXISTS Marketing_meetings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clientID INT NOT NULL,
      followupID INT ,
      title VARCHAR(255),
      date VARCHAR(255),
      startTime VARCHAR(255),
      endTime VARCHAR(255),
      agenda TEXT,
      link TEXT,
      attendees TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (clientID) REFERENCES ClientsData(id) ON DELETE CASCADE,
      FOREIGN KEY (followupID) REFERENCES Followups(id) ON DELETE SET NULL
    );`,

       `
    CREATE TABLE IF NOT EXISTS Fake_company (
    id INT AUTO_INCREMENT PRIMARY KEY,
    companyName VARCHAR(255) NOT NULL
    );
    `,
    `CREATE TABLE IF NOT EXISTS marketing_resources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    link_name VARCHAR(255) NOT NULL,
    link_description TEXT,
    link VARCHAR(500) NOT NULL,
    category ENUM('important', 'rough') NOT NULL DEFAULT 'important',
    employee_id VARCHAR(100) NOT NULL,
    employee_name VARCHAR(255) NOT NULL,
    last_updated_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_employee (employee_id),
    INDEX idx_created_at (created_at)
  );`,
    
    ];

    for (let i = 0; i < tables.length; i++) {
      await new Promise((resolve, reject) => {
        connection.query(tables[i], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log(`✓ Table ${i + 1}/${tables.length} ready`);
    }

    console.log("✓ All tables ready");
  } catch (err) {
    console.error("❌ Table creation failed:", err.message);
  } finally {
    if (connection) connection.release();
  }
}

module.exports = initializeDatabase;
