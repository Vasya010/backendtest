const express = require('express');
const app = express();
const port = 3000;

// Middleware для обработки JSON1
app.use(express.json());

// Пример маршрута
app.get('/', (req, res) => {
    res.send('Привет, это твой бэкенд на Node.js!');
});

// Запуск сервера
app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});