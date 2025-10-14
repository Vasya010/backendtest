const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_very_secure_random_string';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7639223015:AAGdo2oB_uL4pEqXTnnepR4IpwsTSh2_UyY';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'GIMZKRMOGP4F0MOTLVCE';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'WvhFfIzzCkITUrXfD8JfoDne7LmBhnNzDuDBj89I';
const MYSQL_HOST = process.env.MYSQL_HOST || 'vh446.timeweb.ru';
const MYSQL_USER = process.env.MYSQL_USER || 'cz45780_pizzaame';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'Vasya11091109';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'cz45780_pizzaame';

const s3Client = new S3Client({
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  endpoint: 'https://s3.twcstorage.ru',
  region: 'ru-1',
  forcePathStyle: true,
});
const S3_BUCKET = 'a2c31109-3cf2c97b-aca1-42b0-a822-3e0ade279447';

function testS3Connection(callback) {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'test-connection.txt',
    Body: 'This is a test file to check S3 connection.',
  });
  s3Client.send(command, callback);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('image');

function uploadToS3(file, callback) {
  const key = `pizza-images/${Date.now()}${path.extname(file.originalname)}`;
  const params = {
    Bucket: S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  };
  const upload = new Upload({ client: s3Client, params });
  upload.done().then(() => callback(null, key)).catch(callback);
}

function getFromS3(key, callback) {
  const params = { Bucket: S3_BUCKET, Key: key };
  s3Client.send(new GetObjectCommand(params), callback);
}

function deleteFromS3(key, callback) {
  const params = { Bucket: S3_BUCKET, Key: key };
  s3Client.send(new DeleteObjectCommand(params), callback);
}

const db = mysql.createPool({
  host: MYSQL_HOST,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  connectionLimit: 10,
  connectTimeout: 10000,
  acquireTimeout: 10000,
  waitForConnections: true,
  queueLimit: 0,
});

function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Токен отсутствует' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Недействительный токен' });
    req.user = user;
    next();
  });
}

function optionalAuthenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) req.user = user;
      next();
    });
  } else {
    next();
  }
}

app.get('/product-image/:key', optionalAuthenticateToken, (req, res) => {
  const { key } = req.params;
  getFromS3(`pizza-images/${key}`, (err, image) => {
    if (err) return res.status(500).json({ error: `Ошибка получения изображения: ${err.message}` });
    res.setHeader('Content-Type', image.ContentType || 'image/jpeg');
    image.Body.pipe(res);
  });
});

function initializeServer(callback) {
  const maxRetries = 5;
  let retryCount = 0;
  function attemptConnection() {
    db.getConnection((err, connection) => {
      if (err) {
        retryCount++;
        if (retryCount < maxRetries) setTimeout(attemptConnection, 5000);
        else callback(new Error(`MySQL connection failed after ${maxRetries} attempts: ${err.message}`));
        return;
      }
      connection.query('SELECT 1', (err) => {
        if (err) {
          connection.release();
          return callback(new Error(`MySQL connection test failed: ${err.message}`));
        }
        connection.query(`
          CREATE TABLE IF NOT EXISTS branches (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            address VARCHAR(255),
            phone VARCHAR(20),
            telegram_chat_id VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            connection.release();
            return callback(err);
          }
          connection.query('SHOW COLUMNS FROM branches LIKE "address"', (err, branchColumns) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            if (branchColumns.length === 0) {
              connection.query('ALTER TABLE branches ADD COLUMN address VARCHAR(255), ADD COLUMN phone VARCHAR(20)', (err) => {
                if (err) {
                  connection.release();
                  return callback(err);
                }
              });
            }
            connection.query('SHOW COLUMNS FROM branches LIKE "telegram_chat_id"', (err, telegramColumns) => {
              if (err) {
                connection.release();
                return callback(err);
              }
              if (telegramColumns.length === 0) {
                connection.query('ALTER TABLE branches ADD COLUMN telegram_chat_id VARCHAR(50)', (err) => {
                  if (err) {
                    connection.release();
                    return callback(err);
                  }
                });
              }
              connection.query('SELECT * FROM branches', (err, branches) => {
                if (err) {
                  connection.release();
                  return callback(err);
                }
                if (branches.length === 0) {
                  const insertBranches = [
                    ['BOODAI PIZZA', '-1002311447135'],
                    ['Район', '-1002638475628'],
                    ['Араванский', '-1002311447135'],
                    ['Ошский район', '-1002638475628'],
                  ];
                  let inserted = 0;
                  insertBranches.forEach(([name, telegram_chat_id]) => {
                    connection.query(
                      'INSERT INTO branches (name, telegram_chat_id) VALUES (?, ?)',
                      [name, telegram_chat_id],
                      (err) => {
                        if (err) {
                          connection.release();
                          return callback(err);
                        }
                        inserted++;
                        if (inserted === insertBranches.length) continueInitialization();
                      }
                    );
                  });
                } else {
                  const updateQueries = [
                    ['american_pizza.osh', '-1003140309410'],
                    ['Араванский', '-1002311447135'],
                    ['Ошский район', '-1002638475628'],
                  ];
                  let updated = 0;
                  updateQueries.forEach(([name, telegram_chat_id]) => {
                    connection.query(
                      'UPDATE branches SET telegram_chat_id = ? WHERE name = ? AND (telegram_chat_id IS NULL OR telegram_chat_id = "")',
                      [telegram_chat_id, name],
                      (err) => {
                        if (err) {
                          connection.release();
                          return callback(err);
                        }
                        updated++;
                        if (updated === updateQueries.length) continueInitialization();
                      }
                    );
                  });
                }
              });
            });
          });
        });
        function continueInitialization() {
          connection.query('SELECT id, name, telegram_chat_id FROM branches', (err, branches) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            connection.query('SHOW COLUMNS FROM products', (err, productColumns) => {
              if (err) {
                connection.release();
                return callback(err);
              }
              const columns = productColumns.map(col => col.Field);
              let productAlterations = 0;
              const checkProductAlterations = () => {
                productAlterations++;
                if (productAlterations === 3) createSubcategoriesTable();
              };
              if (!columns.includes('mini_recipe')) {
                connection.query('ALTER TABLE products ADD COLUMN mini_recipe TEXT', (err) => {
                  if (err) {
                    connection.release();
                    return callback(err);
                  }
                  checkProductAlterations();
                });
              } else {
                checkProductAlterations();
              }
              if (!columns.includes('sub_category_id')) {
                connection.query('ALTER TABLE products ADD COLUMN sub_category_id INT', (err) => {
                  if (err) {
                    connection.release();
                    return callback(err);
                  }
                  checkProductAlterations();
                });
              } else {
                checkProductAlterations();
              }
              if (!columns.includes('is_pizza')) {
                connection.query('ALTER TABLE products ADD COLUMN is_pizza BOOLEAN DEFAULT FALSE', (err) => {
                  if (err) {
                    connection.release();
                    return callback(err);
                  }
                  checkProductAlterations();
                });
              } else {
                checkProductAlterations();
              }
            });
          });
        }
        function createSubcategoriesTable() {
          connection.query(`
            CREATE TABLE IF NOT EXISTS subcategories (
              id INT AUTO_INCREMENT PRIMARY KEY,
              name VARCHAR(255) NOT NULL,
              category_id INT NOT NULL,
              FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
            )
          `, (err) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            createPromoCodesTable();
          });
        }
        function createPromoCodesTable() {
          connection.query(`
            CREATE TABLE IF NOT EXISTS promo_codes (
              id INT AUTO_INCREMENT PRIMARY KEY,
              code VARCHAR(50) NOT NULL UNIQUE,
              discount_percent INT NOT NULL,
              expires_at TIMESTAMP NULL DEFAULT NULL,
              is_active BOOLEAN DEFAULT TRUE,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `, (err) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            createOrdersTable();
          });
        }
        function createOrdersTable() {
          connection.query(`
            CREATE TABLE IF NOT EXISTS orders (
              id INT AUTO_INCREMENT PRIMARY KEY,
              branch_id INT NOT NULL,
              total DECIMAL(10,2) NOT NULL,
              status ENUM('pending', 'processing', 'completed', 'cancelled') DEFAULT 'pending',
              order_details JSON,
              delivery_details JSON,
              cart_items JSON,
              discount INT DEFAULT 0,
              promo_code VARCHAR(50),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
          `, (err) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            createStoriesTable();
          });
        }
        function createStoriesTable() {
          connection.query(`
            CREATE TABLE IF NOT EXISTS stories (
              id INT AUTO_INCREMENT PRIMARY KEY,
              image VARCHAR(255) NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `, (err) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            createDiscountsTable();
          });
        }
        function createDiscountsTable() {
          connection.query(`
            CREATE TABLE IF NOT EXISTS discounts (
              id INT AUTO_INCREMENT PRIMARY KEY,
              product_id INT NOT NULL,
              discount_percent INT NOT NULL,
              expires_at TIMESTAMP NULL DEFAULT NULL,
              is_active BOOLEAN DEFAULT TRUE,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
            )
          `, (err) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            createBannersTable();
          });
        }
        function createBannersTable() {
          connection.query(`
            CREATE TABLE IF NOT EXISTS banners (
              id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              image VARCHAR(255) NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              title VARCHAR(255) DEFAULT NULL,
              description TEXT DEFAULT NULL,
              button_text VARCHAR(100) DEFAULT NULL,
              promo_code_id INT DEFAULT NULL,
              FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE SET NULL
            )
          `, (err) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            createSaucesTable();
          });
        }
        function createSaucesTable() {
          connection.query(`
            CREATE TABLE IF NOT EXISTS sauces (
              id INT AUTO_INCREMENT PRIMARY KEY,
              name VARCHAR(255) NOT NULL,
              price DECIMAL(10,2) NOT NULL,
              image VARCHAR(255) DEFAULT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `, (err) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            createProductsSaucesTable();
          });
        }
        function createProductsSaucesTable() {
          connection.query(`
            CREATE TABLE IF NOT EXISTS products_sauces (
              product_id INT NOT NULL,
              sauce_id INT NOT NULL,
              PRIMARY KEY (product_id, sauce_id),
              FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
              FOREIGN KEY (sauce_id) REFERENCES sauces(id) ON DELETE CASCADE
            )
          `, (err) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            addDiscountColumns();
          });
        }
        function addDiscountColumns() {
          connection.query('SHOW COLUMNS FROM discounts', (err, discountColumns) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            const discountFields = discountColumns.map(col => col.Field);
            let discountAlterations = 0;
            const checkDiscountAlterations = () => {
              discountAlterations++;
              if (discountAlterations === 2) createAdminUser();
            };
            if (!discountFields.includes('expires_at')) {
              connection.query('ALTER TABLE discounts ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL', (err) => {
                if (err) {
                  connection.release();
                  return callback(err);
                }
                checkDiscountAlterations();
              });
            } else {
              checkDiscountAlterations();
            }
            if (!discountFields.includes('is_active')) {
              connection.query('ALTER TABLE discounts ADD COLUMN is_active BOOLEAN DEFAULT TRUE', (err) => {
                if (err) {
                  connection.release();
                  return callback(err);
                }
                checkDiscountAlterations();
              });
            } else {
              checkDiscountAlterations();
            }
          });
        }
        function createAdminUser() {
          connection.query('SELECT * FROM users WHERE email = ?', ['admin@ameranpizza.com'], (err, users) => {
            if (err) {
              connection.release();
              return callback(err);
            }
            if (users.length === 0) {
              bcrypt.hash('admin123', 10, (err, hashedPassword) => {
                if (err) {
                  connection.release();
                  return callback(err);
                }
                connection.query(
                  'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
                  ['Admin', 'admin@ameranpizza.com', hashedPassword],
                  (err) => {
                    if (err) {
                      connection.release();
                      return callback(err);
                    }
                    connection.release();
                    testS3Connection(callback);
                  }
                );
              });
            } else {
              connection.release();
              testS3Connection(callback);
            }
          });
        }
      });
    });
  }
  attemptConnection();
}

app.get('/api/public/branches', (req, res) => {
  db.query('SELECT id, name, address FROM branches', (err, branches) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json(branches);
  });
});

app.get('/api/public/branches/:branchId/products', (req, res) => {
  const { branchId } = req.params;
  db.query(`
    SELECT p.id, p.name, p.description, p.price_small, p.price_medium, p.price_large,
           p.price_single AS price, p.image AS image_url, c.name AS category,
           d.discount_percent, d.expires_at,
           COALESCE(
             (SELECT JSON_ARRAYAGG(
               JSON_OBJECT(
                 'id', s.id,
                 'name', s.name,
                 'price', s.price,
                 'image', s.image
               )
             )
             FROM products_sauces ps
             LEFT JOIN sauces s ON ps.sauce_id = s.id
             WHERE ps.product_id = p.id AND s.id IS NOT NULL),
             '[]'
           ) as sauces
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN discounts d ON p.id = d.product_id AND d.is_active = TRUE AND (d.expires_at IS NULL OR d.expires_at > NOW())
    WHERE p.branch_id = ?
    GROUP BY p.id
  `, [branchId], (err, products) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    const parsedProducts = products.map(product => ({
      ...product,
      sauces: product.sauces ? JSON.parse(product.sauces).filter(s => s && s.id) : []
    }));
    res.json(parsedProducts);
  });
});

app.get('/api/public/branches/:branchId/orders', (req, res) => {
  const { branchId } = req.params;
  db.query(`
    SELECT id, total, created_at, status
    FROM orders
    WHERE branch_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `, [branchId], (err, orders) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json(orders);
  });
});

app.get('/api/public/stories', (req, res) => {
  db.query('SELECT * FROM stories', (err, stories) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    const storiesWithUrls = stories.map(story => ({
      ...story,
      image: `https://nukesul-brepb-651f.twc1.net/product-image/${story.image.split('/').pop()}`
    }));
    res.json(storiesWithUrls);
  });
});

app.get('/api/public/banners', (req, res) => {
  db.query(`
    SELECT b.id, b.image, b.created_at, b.title, b.description, b.button_text,
           pc.code AS promo_code, pc.discount_percent
    FROM banners b
    LEFT JOIN promo_codes pc ON b.promo_code_id = pc.id
    WHERE pc.is_active = TRUE OR pc.id IS NULL
  `, (err, banners) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    const bannersWithUrls = banners.map(banner => ({
      ...banner,
      image: `https://nukesul-brepb-651f.twc1.net/product-image/${banner.image.split('/').pop()}`
    }));
    res.json(bannersWithUrls);
  });
});

app.post('/api/public/validate-promo', (req, res) => {
  const { promoCode } = req.body;
  db.query(`
    SELECT discount_percent AS discount
    FROM promo_codes
    WHERE code = ? AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
  `, [promoCode], (err, promo) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (promo.length === 0) return res.status(400).json({ error: 'Промокод недействителен' });
    res.json({ discount: promo[0].discount });
  });
});

app.post('/api/public/send-order', (req, res) => {
  const { orderDetails, deliveryDetails, cartItems, discount, promoCode, branchId, paymentMethod } = req.body;
  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({ error: 'Корзина пуста или содержит некорректные данные' });
  }
  if (!branchId) {
    return res.status(400).json({ error: 'Не указан филиал (branchId отсутствует)' });
  }
  db.query('SELECT name, telegram_chat_id FROM branches WHERE id = ?', [branchId], (err, branch) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (branch.length === 0) return res.status(400).json({ error: `Филиал с id ${branchId} не найден` });
    const branchName = branch[0].name;
    const chatId = branch[0].telegram_chat_id;
    if (!chatId) {
      return res.status(500).json({
        error: `Для филиала "${branchName}" не настроен Telegram chat ID. Пожалуйста, свяжитесь с администратором для настройки.`,
      });
    }
    const total = cartItems.reduce((sum, item) => sum + (Number(item.originalPrice) || 0) * item.quantity, 0);
    const discountedTotal = total * (1 - (discount || 0) / 100);
    const escapeMarkdown = (text) => (text ? text.replace(/([_*[\]()~`>#+-.!])/g, '\\$1') : 'Нет');
    const paymentMethodText = paymentMethod === 'cash' ? 'Наличными' : paymentMethod === 'card' ? 'Картой' : 'Не указан';
    const orderText = `
📦 *Новый заказ:*
🏪 Филиал: ${escapeMarkdown(branchName)}
👤 Имя: ${escapeMarkdown(orderDetails.name || deliveryDetails.name)}
📞 Телефон: ${escapeMarkdown(orderDetails.phone || deliveryDetails.phone)}
📝 Комментарии: ${escapeMarkdown(orderDetails.comments || deliveryDetails.comments || "Нет")}
📍 Адрес доставки: ${escapeMarkdown(deliveryDetails.address || "Самовывоз")}
💳 Способ оплаты: ${escapeMarkdown(paymentMethodText)}
🛒 *Товары:*
${cartItems.map((item) => `- ${escapeMarkdown(item.name)} (${item.quantity} шт. по ${item.originalPrice} сом)`).join('\n')}
💰 Итоговая стоимость: ${total.toFixed(2)} сом
${promoCode ? `💸 Скидка (${discount}%): ${discountedTotal.toFixed(2)} сом` : '💸 Скидка не применена'}
💰 Итоговая сумма: ${discountedTotal.toFixed(2)} сом
    `;
    db.query(
      `
      INSERT INTO orders (branch_id, total, status, order_details, delivery_details, cart_items, discount, promo_code)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
    `,
      [
        branchId,
        discountedTotal,
        JSON.stringify(orderDetails),
        JSON.stringify(deliveryDetails),
        JSON.stringify(cartItems),
        discount || 0,
        promoCode || null,
      ],
      (err, result) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            chat_id: chatId,
            text: orderText,
            parse_mode: 'Markdown',
          }
        ).then(response => {
          res.status(200).json({ message: 'Заказ успешно отправлен', orderId: result.insertId });
        }).catch(telegramError => {
          const errorDescription = telegramError.response?.data?.description || telegramError.message;
          if (telegramError.response?.data?.error_code === 403) {
            return res.status(500).json({
              error: `Бот не имеет прав для отправки сообщений в группу (chat_id: ${chatId}). Убедитесь, что бот добавлен в группу и имеет права администратора.`,
            });
          }
          return res.status(500).json({ error: `Ошибка отправки в Telegram: ${errorDescription}` });
        });
      }
    );
  });
});

app.get('/', (req, res) => res.send('Booday Pizza API'));

app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Введите email и пароль' });
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, users) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (users.length === 0) return res.status(401).json({ error: 'Неверный email или пароль' });
    const user = users[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      if (!isMatch) return res.status(401).json({ error: 'Неверный email или пароль' });
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
      res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
  });
});

app.get('/branches', authenticateToken, (req, res) => {
  db.query('SELECT * FROM branches', (err, branches) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json(branches);
  });
});

app.get('/products', authenticateToken, (req, res) => {
  db.query(`
    SELECT p.*,
           b.name as branch_name,
           c.name as category_name,
           s.name as subcategory_name,
           d.discount_percent,
           d.expires_at,
           d.is_active as discount_active,
           COALESCE(
             (SELECT JSON_ARRAYAGG(
               JSON_OBJECT(
                 'id', sa.id,
                 'name', sa.name,
                 'price', sa.price,
                 'image', sa.image
               )
             )
             FROM products_sauces ps
             LEFT JOIN sauces sa ON ps.sauce_id = sa.id
             WHERE ps.product_id = p.id AND sa.id IS NOT NULL),
             '[]'
           ) as sauces
    FROM products p
    LEFT JOIN branches b ON p.branch_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN subcategories s ON p.sub_category_id = s.id
    LEFT JOIN discounts d ON p.id = d.product_id AND d.is_active = TRUE AND (d.expires_at IS NULL OR d.expires_at > NOW())
    GROUP BY p.id
  `, (err, products) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    const parsedProducts = products.map(product => ({
      ...product,
      sauces: product.sauces ? JSON.parse(product.sauces).filter(s => s && s.id) : []
    }));
    res.json(parsedProducts);
  });
});

app.get('/discounts', authenticateToken, (req, res) => {
  db.query(`
    SELECT d.*, p.name as product_name
    FROM discounts d
    JOIN products p ON d.product_id = p.id
    WHERE d.is_active = TRUE AND (d.expires_at IS NULL OR d.expires_at > NOW())
  `, (err, discounts) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json(discounts);
  });
});

app.get('/stories', authenticateToken, (req, res) => {
  db.query('SELECT * FROM stories', (err, stories) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    const storiesWithUrls = stories.map(story => ({
      ...story,
      image: `https://nukesul-brepb-651f.twc1.net/product-image/${story.image.split('/').pop()}`
    }));
    res.json(storiesWithUrls);
  });
});

app.get('/banners', authenticateToken, (req, res) => {
  db.query(`
    SELECT b.*, pc.code AS promo_code, pc.discount_percent
    FROM banners b
    LEFT JOIN promo_codes pc ON b.promo_code_id = pc.id
  `, (err, banners) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    const bannersWithUrls = banners.map(banner => ({
      ...banner,
      image: `https://nukesul-brepb-651f.twc1.net/product-image/${banner.image.split('/').pop()}`
    }));
    res.json(bannersWithUrls);
  });
});

app.get('/sauces', authenticateToken, (req, res) => {
  db.query('SELECT * FROM sauces', (err, sauces) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    const saucesWithUrls = sauces.map(sauce => ({
      ...sauce,
      image: sauce.image ? `https://nukesul-brepb-651f.twc1.net/product-image/${sauce.image.split('/').pop()}` : null
    }));
    res.json(saucesWithUrls);
  });
});

app.get('/categories', authenticateToken, (req, res) => {
  db.query('SELECT * FROM categories', (err, categories) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json(categories);
  });
});

app.get('/promo-codes', authenticateToken, (req, res) => {
  db.query('SELECT * FROM promo_codes', (err, promoCodes) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json(promoCodes);
  });
});

app.get('/promo-codes/check/:code', authenticateToken, (req, res) => {
  const { code } = req.params;
  db.query(`
    SELECT * FROM promo_codes
    WHERE code = ? AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
  `, [code], (err, promo) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (promo.length === 0) return res.status(404).json({ error: 'Промокод не найден или недействителен' });
    res.json(promo[0]);
  });
});

app.post('/promo-codes', authenticateToken, (req, res) => {
  const { code, discountPercent, expiresAt, isActive } = req.body;
  if (!code || !discountPercent) return res.status(400).json({ error: 'Код и процент скидки обязательны' });
  db.query(
    'INSERT INTO promo_codes (code, discount_percent, expires_at, is_active) VALUES (?, ?, ?, ?)',
    [code, discountPercent, expiresAt || null, isActive !== undefined ? isActive : true],
    (err, result) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      res.status(201).json({ id: result.insertId, code, discount_percent: discountPercent, expires_at: expiresAt || null, is_active: isActive !== undefined ? isActive : true });
    }
  );
});

app.put('/promo-codes/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { code, discountPercent, expiresAt, isActive } = req.body;
  if (!code || !discountPercent) return res.status(400).json({ error: 'Код и процент скидки обязательны' });
  db.query(
    'UPDATE promo_codes SET code = ?, discount_percent = ?, expires_at = ?, is_active = ? WHERE id = ?',
    [code, discountPercent, expiresAt || null, isActive !== undefined ? isActive : true, id],
    (err) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      res.json({ id, code, discount_percent: discountPercent, expires_at: expiresAt || null, is_active: isActive !== undefined ? isActive : true });
    }
  );
});

app.delete('/promo-codes/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM promo_codes WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json({ message: 'Промокод удален' });
  });
});

app.post('/branches', authenticateToken, (req, res) => {
  const { name, address, phone, telegram_chat_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Название филиала обязательно' });
  if (telegram_chat_id && !telegram_chat_id.match(/^-\d+$/)) {
    return res.status(400).json({ error: 'Некорректный формат telegram_chat_id. Должен начинаться с "-" и содержать только цифры.' });
  }
  db.query(
    'INSERT INTO branches (name, address, phone, telegram_chat_id) VALUES (?, ?, ?, ?)',
    [name, address || null, phone || null, telegram_chat_id || null],
    (err, result) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      res.status(201).json({ id: result.insertId, name, address, phone, telegram_chat_id });
    }
  );
});

app.put('/branches/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, address, phone, telegram_chat_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Название филиала обязательно' });
  if (telegram_chat_id && !telegram_chat_id.match(/^-\d+$/)) {
    return res.status(400).json({ error: 'Некорректный формат telegram_chat_id. Должен начинаться с "-" и содержать только цифры.' });
  }
  db.query(
    'UPDATE branches SET name = ?, address = ?, phone = ?, telegram_chat_id = ? WHERE id = ?',
    [name, address || null, phone || null, telegram_chat_id || null, id],
    (err) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      res.json({ id, name, address, phone, telegram_chat_id });
    }
  );
});

app.delete('/branches/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM branches WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json({ message: 'Филиал удален' });
  });
});

app.post('/categories', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Название категории обязательно' });
  db.query('INSERT INTO categories (name) VALUES (?)', [name], (err, result) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.status(201).json({ id: result.insertId, name });
  });
});

app.put('/categories/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Название категории обязательно' });
  db.query('UPDATE categories SET name = ? WHERE id = ?', [name, id], (err) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json({ id, name });
  });
});

app.delete('/categories/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM categories WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json({ message: 'Категория удалена' });
  });
});

app.get('/subcategories', authenticateToken, (req, res) => {
  db.query(`
    SELECT s.*, c.name as category_name
    FROM subcategories s
    JOIN categories c ON s.category_id = c.id
  `, (err, subcategories) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json(subcategories);
  });
});

app.post('/subcategories', authenticateToken, (req, res) => {
  const { name, categoryId } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: 'Название и категория обязательны' });
  db.query('INSERT INTO subcategories (name, category_id) VALUES (?, ?)', [name, categoryId], (err, result) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    db.query(
      'SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?',
      [result.insertId],
      (err, newSubcategory) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        res.status(201).json(newSubcategory[0]);
      }
    );
  });
});

app.put('/subcategories/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, categoryId } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: 'Название и категория обязательны' });
  db.query('UPDATE subcategories SET name = ?, category_id = ? WHERE id = ?', [name, categoryId, id], (err) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    db.query(
      'SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?',
      [id],
      (err, updatedSubcategory) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        res.json(updatedSubcategory[0]);
      }
    );
  });
});

app.delete('/subcategories/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM subcategories WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json({ message: 'Подкатегория удалена' });
  });
});

app.post('/products', authenticateToken, (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Ошибка загрузки изображения: ${err.message}` });
    const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId, sauceIds } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Изображение обязательно' });
    uploadToS3(req.file, (err, imageKey) => {
      if (err) return res.status(500).json({ error: `Ошибка загрузки в S3: ${err.message}` });
      if (!name || !branchId || !categoryId || !imageKey) {
        return res.status(400).json({ error: 'Все обязательные поля должны быть заполнены (name, branchId, categoryId, image)' });
      }
      db.query(
        `INSERT INTO products (
          name, description, price_small, price_medium, price_large, price_single,
          branch_id, category_id, sub_category_id, image
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          description || null,
          priceSmall ? parseFloat(priceSmall) : null,
          priceMedium ? parseFloat(priceMedium) : null,
          priceLarge ? parseFloat(priceLarge) : null,
          priceSingle ? parseFloat(priceSingle) : null,
          branchId,
          categoryId,
          subCategoryId || null,
          imageKey,
        ],
        (err, result) => {
          if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
          if (sauceIds) {
            let sauceIdsArray = Array.isArray(sauceIds) ? sauceIds : JSON.parse(sauceIds || '[]');
            if (!Array.isArray(sauceIdsArray)) {
              return res.status(400).json({ error: 'sauceIds должен быть массивом' });
            }
            let sauceInsertions = 0;
            if (sauceIdsArray.length === 0) {
              fetchNewProduct();
            } else {
              sauceIdsArray.forEach(sauceId => {
                db.query('SELECT id FROM sauces WHERE id = ?', [sauceId], (err, sauce) => {
                  if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
                  if (sauce.length === 0) {
                    sauceInsertions++;
                    if (sauceInsertions === sauceIdsArray.length) fetchNewProduct();
                    return;
                  }
                  db.query(
                    'INSERT INTO products_sauces (product_id, sauce_id) VALUES (?, ?)',
                    [result.insertId, sauceId],
                    (err) => {
                      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
                      sauceInsertions++;
                      if (sauceInsertions === sauceIdsArray.length) fetchNewProduct();
                    }
                  );
                });
              });
            }
          } else {
            fetchNewProduct();
          }
          function fetchNewProduct() {
            db.query(
              `
              SELECT p.*,
                     b.name as branch_name,
                     c.name as category_name,
                     s.name as subcategory_name,
                     COALESCE(
                       (SELECT JSON_ARRAYAGG(
                         JSON_OBJECT(
                           'id', sa.id,
                           'name', sa.name,
                           'price', sa.price,
                           'image', sa.image
                         )
                       )
                       FROM products_sauces ps
                       LEFT JOIN sauces sa ON ps.sauce_id = sa.id
                       WHERE ps.product_id = p.id AND sa.id IS NOT NULL),
                       '[]'
                     ) as sauces
              FROM products p
              LEFT JOIN branches b ON p.branch_id = b.id
              LEFT JOIN categories c ON p.category_id = c.id
              LEFT JOIN subcategories s ON p.sub_category_id = s.id
              WHERE p.id = ?
              GROUP BY p.id
            `,
              [result.insertId],
              (err, newProduct) => {
                if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
                res.status(201).json({
                  ...newProduct[0],
                  sauces: newProduct[0].sauces ? JSON.parse(newProduct[0].sauces).filter(s => s.id) : []
                });
              }
            );
          }
        }
      );
    });
  });
});

app.put('/products/:id', authenticateToken, (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Ошибка загрузки изображения: ${err.message}` });
    const { id } = req.params;
    const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId, sauceIds } = req.body;
    let imageKey;
    db.query('SELECT image FROM products WHERE id = ?', [id], (err, existing) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      if (existing.length === 0) return res.status(404).json({ error: 'Продукт не найден' });
      if (req.file) {
        uploadToS3(req.file, (err, key) => {
          if (err) return res.status(500).json({ error: `Ошибка загрузки в S3: ${err.message}` });
          imageKey = key;
          if (existing[0].image) deleteFromS3(existing[0].image, updateProduct);
          else updateProduct();
        });
      } else {
        imageKey = existing[0].image;
        updateProduct();
      }
      function updateProduct() {
        db.query(
          `UPDATE products SET
            name = ?, description = ?, price_small = ?, price_medium = ?, price_large = ?,
            price_single = ?, branch_id = ?, category_id = ?, sub_category_id = ?, image = ?
          WHERE id = ?`,
          [
            name,
            description || null,
            priceSmall ? parseFloat(priceSmall) : null,
            priceMedium ? parseFloat(priceMedium) : null,
            priceLarge ? parseFloat(priceLarge) : null,
            priceSingle ? parseFloat(priceSingle) : null,
            branchId,
            categoryId,
            subCategoryId || null,
            imageKey,
            id,
          ],
          (err) => {
            if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
            db.query('DELETE FROM products_sauces WHERE product_id = ?', [id], (err) => {
              if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
              if (sauceIds) {
                let sauceIdsArray = Array.isArray(sauceIds) ? sauceIds : JSON.parse(sauceIds || '[]');
                if (!Array.isArray(sauceIdsArray)) {
                  return res.status(400).json({ error: 'sauceIds должен быть массивом' });
                }
                let sauceInsertions = 0;
                if (sauceIdsArray.length === 0) {
                  fetchUpdatedProduct();
                } else {
                  sauceIdsArray.forEach(sauceId => {
                    db.query('SELECT id FROM sauces WHERE id = ?', [sauceId], (err, sauce) => {
                      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
                      if (sauce.length === 0) {
                        sauceInsertions++;
                        if (sauceInsertions === sauceIdsArray.length) fetchUpdatedProduct();
                        return;
                      }
                      db.query(
                        'INSERT INTO products_sauces (product_id, sauce_id) VALUES (?, ?)',
                        [id, sauceId],
                        (err) => {
                          if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
                          sauceInsertions++;
                          if (sauceInsertions === sauceIdsArray.length) fetchUpdatedProduct();
                        }
                      );
                    });
                  });
                }
              } else {
                fetchUpdatedProduct();
              }
            });
          });
      }
      function fetchUpdatedProduct() {
        db.query(
          `
          SELECT p.*,
                 b.name as branch_name,
                 c.name as category_name,
                 s.name as subcategory_name,
                 COALESCE(
                   (SELECT JSON_ARRAYAGG(
                     JSON_OBJECT(
                       'id', sa.id,
                       'name', sa.name,
                       'price', sa.price,
                       'image', sa.image
                     )
                   )
                   FROM products_sauces ps
                   LEFT JOIN sauces sa ON ps.sauce_id = sa.id
                   WHERE ps.product_id = p.id AND sa.id IS NOT NULL),
                   '[]'
                 ) as sauces
          FROM products p
          LEFT JOIN branches b ON p.branch_id = b.id
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN subcategories s ON p.sub_category_id = s.id
          WHERE p.id = ?
          GROUP BY p.id
        `,
          [id],
          (err, updatedProduct) => {
            if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
            res.json({
              ...updatedProduct[0],
              sauces: updatedProduct[0].sauces ? JSON.parse(updatedProduct[0].sauces).filter(s => s.id) : []
            });
          }
        );
      }
    });
  });
});

app.delete('/products/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('SELECT image FROM products WHERE id = ?', [id], (err, product) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (product.length === 0) return res.status(404).json({ error: 'Продукт не найден' });
    if (product[0].image) deleteFromS3(product[0].image, deleteProduct);
    else deleteProduct();
    function deleteProduct() {
      db.query('DELETE FROM products WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        res.json({ message: 'Продукт удален' });
      });
    }
  });
});

app.post('/discounts', authenticateToken, (req, res) => {
  const { productId, discountPercent, expiresAt, isActive } = req.body;
  if (!productId || !discountPercent) return res.status(400).json({ error: 'ID продукта и процент скидки обязательны' });
  if (discountPercent < 1 || discountPercent > 100) return res.status(400).json({ error: 'Процент скидки должен быть от 1 до 100' });
  db.query('SELECT id FROM products WHERE id = ?', [productId], (err, product) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (product.length === 0) return res.status(404).json({ error: 'Продукт не найден' });
    db.query(`
      SELECT id FROM discounts
      WHERE product_id = ? AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
    `, [productId], (err, existingDiscount) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      if (existingDiscount.length > 0) return res.status(400).json({ error: 'Для этого продукта уже существует активная скидка' });
      db.query(
        'INSERT INTO discounts (product_id, discount_percent, expires_at, is_active) VALUES (?, ?, ?, ?)',
        [productId, discountPercent, expiresAt || null, isActive !== undefined ? isActive : true],
        (err, result) => {
          if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
          db.query(
            `SELECT d.*, p.name as product_name
            FROM discounts d
            JOIN products p ON d.product_id = p.id
            WHERE d.id = ?`,
            [result.insertId],
            (err, newDiscount) => {
              if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
              res.status(201).json(newDiscount[0]);
            }
          );
        }
      );
    });
  });
});

app.put('/discounts/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { productId, discountPercent, expiresAt, isActive } = req.body;
  if (!productId || !discountPercent) return res.status(400).json({ error: 'ID продукта и процент скидки обязательны' });
  if (discountPercent < 1 || discountPercent > 100) return res.status(400).json({ error: 'Процент скидки должен быть от 1 до 100' });
  db.query('SELECT product_id FROM discounts WHERE id = ?', [id], (err, discount) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (discount.length === 0) return res.status(404).json({ error: 'Скидка не найдена' });
    db.query('SELECT id FROM products WHERE id = ?', [productId], (err, product) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      if (product.length === 0) return res.status(404).json({ error: 'Продукт не найден' });
      if (discount[0].product_id !== productId) {
        db.query(`
          SELECT id FROM discounts
          WHERE product_id = ? AND id != ? AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
        `, [productId, id], (err, existingDiscount) => {
          if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
          if (existingDiscount.length > 0) return res.status(400).json({ error: 'Для этого продукта уже существует другая активная скидка' });
          updateDiscount();
        });
      } else {
        updateDiscount();
      }
      function updateDiscount() {
        db.query(
          'UPDATE discounts SET product_id = ?, discount_percent = ?, expires_at = ?, is_active = ? WHERE id = ?',
          [productId, discountPercent, expiresAt || null, isActive !== undefined ? isActive : true, id],
          (err) => {
            if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
            db.query(
              `SELECT d.*, p.name as product_name
              FROM discounts d
              JOIN products p ON d.product_id = p.id
              WHERE d.id = ?`,
              [id],
              (err, updatedDiscount) => {
                if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
                res.json(updatedDiscount[0]);
              }
            );
          }
        );
      }
    });
  });
});

app.delete('/discounts/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query(
    `SELECT d.*, p.name as product_name
    FROM discounts d
    JOIN products p ON d.product_id = p.id
    WHERE d.id = ?`,
    [id],
    (err, discount) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      if (discount.length === 0) return res.status(404).json({ error: 'Скидка не найдена' });
      db.query('DELETE FROM discounts WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        res.json({ message: 'Скидка удалена', product: { id: discount[0].product_id, name: discount[0].product_name } });
      });
    }
  );
});

app.post('/banners', authenticateToken, (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Ошибка загрузки изображения: ${err.message}` });
    const { title, description, button_text, promo_code_id } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Изображение обязательно' });
    uploadToS3(req.file, (err, imageKey) => {
      if (err) return res.status(500).json({ error: `Ошибка загрузки в S3: ${err.message}` });
      if (promo_code_id) {
        db.query('SELECT id FROM promo_codes WHERE id = ?', [promo_code_id], (err, promo) => {
          if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
          if (promo.length === 0) return res.status(404).json({ error: 'Промокод не найден' });
          insertBanner();
        });
      } else {
        insertBanner();
      }
      function insertBanner() {
        db.query(
          'INSERT INTO banners (image, title, description, button_text, promo_code_id) VALUES (?, ?, ?, ?, ?)',
          [imageKey, title || null, description || null, button_text || null, promo_code_id || null],
          (err, result) => {
            if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
            db.query(
              `SELECT b.*, pc.code AS promo_code, pc.discount_percent
              FROM banners b
              LEFT JOIN promo_codes pc ON b.promo_code_id = pc.id
              WHERE b.id = ?`,
              [result.insertId],
              (err, newBanner) => {
                if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
                res.status(201).json({
                  ...newBanner[0],
                  image: `https://nukesul-brepb-651f.twc1.net/product-image/${newBanner[0].image.split('/').pop()}`
                });
              }
            );
          }
        );
      }
    });
  });
});

app.put('/banners/:id', authenticateToken, (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Ошибка загрузки изображения: ${err.message}` });
    const { id } = req.params;
    const { title, description, button_text, promo_code_id } = req.body;
    let imageKey;
    db.query('SELECT image FROM banners WHERE id = ?', [id], (err, existing) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      if (existing.length === 0) return res.status(404).json({ error: 'Баннер не найден' });
      if (req.file) {
        uploadToS3(req.file, (err, key) => {
          if (err) return res.status(500).json({ error: `Ошибка загрузки в S3: ${err.message}` });
          imageKey = key;
          if (existing[0].image) deleteFromS3(existing[0].image, updateBanner);
          else updateBanner();
        });
      } else {
        imageKey = existing[0].image;
        updateBanner();
      }
      function updateBanner() {
        if (promo_code_id) {
          db.query('SELECT id FROM promo_codes WHERE id = ?', [promo_code_id], (err, promo) => {
            if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
            if (promo.length === 0) return res.status(404).json({ error: 'Промокод не найден' });
            performUpdate();
          });
        } else {
          performUpdate();
        }
        function performUpdate() {
          db.query(
            'UPDATE banners SET image = ?, title = ?, description = ?, button_text = ?, promo_code_id = ? WHERE id = ?',
            [imageKey, title || null, description || null, button_text || null, promo_code_id || null, id],
            (err) => {
              if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
              db.query(
                `SELECT b.*, pc.code AS promo_code, pc.discount_percent
                FROM banners b
                LEFT JOIN promo_codes pc ON b.promo_code_id = pc.id
                WHERE b.id = ?`,
                [id],
                (err, updatedBanner) => {
                  if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
                  res.json({
                    ...updatedBanner[0],
                    image: `https://nukesul-brepb-651f.twc1.net/product-image/${updatedBanner[0].image.split('/').pop()}`
                  });
                }
              );
            }
          );
        }
      }
    });
  });
});

app.delete('/banners/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('SELECT image FROM banners WHERE id = ?', [id], (err, banner) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (banner.length === 0) return res.status(404).json({ error: 'Баннер не найден' });
    if (banner[0].image) deleteFromS3(banner[0].image, deleteBanner);
    else deleteBanner();
    function deleteBanner() {
      db.query('DELETE FROM banners WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        res.json({ message: 'Баннер удален' });
      });
    }
  });
});

app.post('/stories', authenticateToken, (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Ошибка загрузки изображения: ${err.message}` });
    if (!req.file) return res.status(400).json({ error: 'Изображение обязательно' });
    uploadToS3(req.file, (err, imageKey) => {
      if (err) return res.status(500).json({ error: `Ошибка загрузки в S3: ${err.message}` });
      db.query('INSERT INTO stories (image) VALUES (?)', [imageKey], (err, result) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        res.status(201).json({
          id: result.insertId,
          image: `https://nukesul-brepb-651f.twc1.net/product-image/${imageKey.split('/').pop()}`,
          created_at: new Date()
        });
      });
    });
  });
});

app.delete('/stories/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('SELECT image FROM stories WHERE id = ?', [id], (err, story) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (story.length === 0) return res.status(404).json({ error: 'История не найдена' });
    if (story[0].image) deleteFromS3(story[0].image, deleteStory);
    else deleteStory();
    function deleteStory() {
      db.query('DELETE FROM stories WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        res.json({ message: 'История удалена' });
      });
    }
  });
});

app.post('/sauces', authenticateToken, (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Ошибка загрузки изображения: ${err.message}` });
    const { name, price } = req.body;
    let imageKey = null;
    if (!name || !price) return res.status(400).json({ error: 'Название и цена обязательны' });
    if (req.file) {
      uploadToS3(req.file, (err, key) => {
        if (err) return res.status(500).json({ error: `Ошибка загрузки в S3: ${err.message}` });
        imageKey = key;
        insertSauce();
      });
    } else {
      insertSauce();
    }
    function insertSauce() {
      db.query(
        'INSERT INTO sauces (name, price, image) VALUES (?, ?, ?)',
        [name, parseFloat(price), imageKey],
        (err, result) => {
          if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
          res.status(201).json({
            id: result.insertId,
            name,
            price: parseFloat(price),
            image: imageKey ? `https://nukesul-brepb-651f.twc1.net/product-image/${imageKey.split('/').pop()}` : null,
            created_at: new Date()
          });
        }
      );
    }
  });
});

app.put('/sauces/:id', authenticateToken, (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Ошибка загрузки изображения: ${err.message}` });
    const { id } = req.params;
    const { name, price } = req.body;
    let imageKey;
    if (!name || !price) return res.status(400).json({ error: 'Название и цена обязательны' });
    db.query('SELECT image FROM sauces WHERE id = ?', [id], (err, existing) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      if (existing.length === 0) return res.status(404).json({ error: 'Соус не найден' });
      if (req.file) {
        uploadToS3(req.file, (err, key) => {
          if (err) return res.status(500).json({ error: `Ошибка загрузки в S3: ${err.message}` });
          imageKey = key;
          if (existing[0].image) deleteFromS3(existing[0].image, updateSauce);
          else updateSauce();
        });
      } else {
        imageKey = existing[0].image;
        updateSauce();
      }
      function updateSauce() {
        db.query(
          'UPDATE sauces SET name = ?, price = ?, image = ? WHERE id = ?',
          [name, parseFloat(price), imageKey, id],
          (err) => {
            if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
            res.json({
              id,
              name,
              price: parseFloat(price),
              image: imageKey ? `https://nukesul-brepb-651f.twc1.net/product-image/${imageKey.split('/').pop()}` : null,
              created_at: existing[0].created_at
            });
          }
        );
      }
    });
  });
});

app.delete('/sauces/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('SELECT image FROM sauces WHERE id = ?', [id], (err, sauce) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (sauce.length === 0) return res.status(404).json({ error: 'Соус не найден' });
    if (sauce[0].image) deleteFromS3(sauce[0].image, deleteSauce);
    else deleteSauce();
    function deleteSauce() {
      db.query('DELETE FROM sauces WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
        res.json({ message: 'Соус удален' });
      });
    }
  });
});

app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Все поля обязательны' });
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, users) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (users.length > 0) return res.status(400).json({ error: 'Email уже зарегистрирован' });
    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      db.query(
        'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
        [name, email, hashedPassword],
        (err, result) => {
          if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
          const token = jwt.sign({ id: result.insertId, email }, JWT_SECRET, { expiresIn: '1h' });
          res.status(201).json({ token, user: { id: result.insertId, name, email } });
        }
      );
    });
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Введите email и пароль' });
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, users) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    if (users.length === 0) return res.status(401).json({ error: 'Неверный email или пароль' });
    const user = users[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
      if (!isMatch) return res.status(401).json({ error: 'Неверный email или пароль' });
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
      res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
  });
});

app.get('/users', authenticateToken, (req, res) => {
  db.query('SELECT id, name, email FROM users', (err, users) => {
    if (err) return res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
    res.json(users);
  });
});

initializeServer((err) => {
  if (err) process.exit(1);
  const PORT = process.env.PORT || 3000;
  app.listen(PORT);
});