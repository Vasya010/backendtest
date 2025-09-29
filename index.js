const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(cors()); // Enable CORS for React frontend1

// MySQL connection configuration
const dbConfig = {
  host: 'vh446.timeweb.ru',
  user: 'cz45780_pizzaame',
  password: 'Vasya11091109',
  database: 'cz45780_pizzaame',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test connection on startup
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to MySQL database successfully');
    connection.release();
  } catch (err) {
    console.error('MySQL connection error:', err.message);
  }
};

// Create admins table if it doesn't exist
const createAdminsTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.execute(query);
    console.log('Admins table ready');
  } catch (err) {
    console.error('Error creating admins table:', err.message);
  }
};

// Create default admin if doesn't exist
const createDefaultAdmin = async () => {
  try {
    const [rows] = await pool.execute('SELECT id FROM admins WHERE email = ?', ['admin@ameranpizza.com']);
    if (rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10); // Default password
      await pool.execute(
        'INSERT INTO admins (email, password) VALUES (?, ?)',
        ['admin@ameranpizza.com', hashedPassword]
      );
      console.log('Default admin created: admin@ameranpizza.com / admin123');
    } else {
      console.log('Admin already exists');
    }
  } catch (err) {
    console.error('Error creating default admin:', err.message);
  }
};

// Initialize database on startup
const initializeDatabase = async () => {
  await testConnection();
  await createAdminsTable();
  await createDefaultAdmin();
};

// Admin login route
app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.execute('SELECT * FROM admins WHERE email = ?', [email]);
    const admin = rows[0];

    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: admin.id, role: admin.role }, 'your_jwt_secret', {
      expiresIn: '1h',
    });

    res.json({
      token,
      user: { id: admin.id, email: admin.email, role: admin.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Protected route example (e.g., for /branches)
app.get('/branches', authenticateToken, async (req, res) => {
  try {
    // Here you can add logic to fetch branches from database if needed
    res.json({ 
      message: 'Protected data accessed', 
      userId: req.user.id,
      branches: [] // Add your branches data here
    });
  } catch (err) {
    console.error('Error fetching branches:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, 'your_jwt_secret', (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

// Default route
app.get('/', (req, res) => {
  res.send('Привет, это твой бэкенд на Node.js для Ameran Pizza!');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database connections...');
  await pool.end();
  process.exit(0);
});

// Start server
const startServer = async () => {
  await initializeDatabase();
  app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
  });
};

startServer();