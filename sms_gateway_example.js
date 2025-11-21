// Простой пример SMS Gateway для вашего сервера
// Запустите: node sms_gateway_example.js

const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_KEY = process.env.SMS_GATEWAY_API_KEY || 'your_secret_key_here';
const PORT = process.env.SMS_GATEWAY_PORT || 8080;

// Функция отправки SMS через команду (адаптируйте под ваш способ)
async function sendSMSCommand(phone, message) {
  try {
    // ВАРИАНТ 1: Через gammu (если установлен)
    // const command = `gammu sendsms TEXT ${phone} -text "${message}"`;
    
    // ВАРИАНТ 2: Через curl к другому API
    // const command = `curl -X POST 'http://ваш-sms-api.com/send' -d 'phone=${phone}&message=${encodeURIComponent(message)}'`;
    
    // ВАРИАНТ 3: Через Python скрипт
    // const command = `python3 /path/to/sms_sender.py ${phone} "${message}"`;
    
    // ВАРИАНТ 4: Через API оператора (пример для Beeline/Megacom/O!)
    // const command = `curl -X POST 'https://api.operator.kg/sms/send' \\
    //   -H 'Authorization: Bearer YOUR_TOKEN' \\
    //   -d '{"phone":"${phone}","message":"${message}"}'`;
    
    // ПРИМЕР: Простая команда (замените на вашу)
    const command = `echo "SMS to ${phone}: ${message}"`;
    
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr) {
      console.error('Ошибка выполнения команды:', stderr);
      return false;
    }
    
    console.log('Команда выполнена:', stdout);
    return true;
  } catch (error) {
    console.error('Ошибка отправки SMS:', error);
    return false;
  }
}

// Endpoint для отправки SMS
app.post('/send', async (req, res) => {
  try {
    const { api_key, phone, message, code } = req.body;
    
    // Проверка API ключа
    if (!api_key || api_key !== API_KEY) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid API key' 
      });
    }
    
    // Проверка обязательных полей
    if (!phone || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Phone and message are required' 
      });
    }
    
    console.log(`\n📤 Отправка SMS:`);
    console.log(`   Телефон: ${phone}`);
    console.log(`   Сообщение: ${message}`);
    console.log(`   Код: ${code || 'N/A'}\n`);
    
    // Отправка SMS
    const result = await sendSMSCommand(phone, message);
    
    if (result) {
      console.log(`✅ SMS успешно отправлено на ${phone}\n`);
      res.json({ 
        success: true, 
        status: 'sent',
        phone: phone 
      });
    } else {
      console.log(`❌ Ошибка отправки SMS на ${phone}\n`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to send SMS' 
      });
    }
  } catch (error) {
    console.error('Ошибка обработки запроса:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET endpoint (для совместимости)
app.get('/send', async (req, res) => {
  try {
    const { api_key, phone, message, code } = req.query;
    
    if (!api_key || api_key !== API_KEY) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid API key' 
      });
    }
    
    if (!phone || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Phone and message are required' 
      });
    }
    
    const result = await sendSMSCommand(phone, message);
    
    if (result) {
      res.json({ success: true, status: 'sent' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to send SMS' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SMS Gateway' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 SMS Gateway запущен на порту ${PORT}`);
  console.log(`📝 API Key: ${API_KEY}`);
  console.log(`📡 Endpoint: http://localhost:${PORT}/send\n`);
  console.log('⚠️  ВАЖНО: Адаптируйте функцию sendSMSCommand() под ваш способ отправки SMS!\n');
});



<<<<<<< HEAD

=======
>>>>>>> f3b444dc12afd12ba78c1c0c7a859b4f0c89457d
