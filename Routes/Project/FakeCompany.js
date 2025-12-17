const express = require('express');
const router = express.Router();
const db = require('../../dataBase/connection');

// GET: Fetch all companies from Fake_company table
router.get('/companies', (req, res) => {
  console.log("GET /api/companies called");

  const query = `
    SELECT 
      id,
      companyName
    FROM Fake_company
    ORDER BY companyName ASC
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching companies:", err);
      return res.status(500).json({
        status: 'error',
        message: 'Database error occurred',
        error: err.message
      });
    }

    console.log(`Found ${results.length} companies`);

    res.json({
      status: 'success',
      data: results
    });
  });
});

module.exports = router;
