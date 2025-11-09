# Настройка локального SMS Gateway на сервере

## Вариант 1: Простой HTTP API для SMS

Создайте простой скрипт на вашем сервере, который будет отправлять SMS через модем или GSM шлюз.

### Пример PHP скрипта (sms_gateway.php)

```php
<?php
header('Content-Type: application/json');

$api_key = $_GET['api_key'] ?? $_POST['api_key'] ?? '';
$phone = $_GET['phone'] ?? $_POST['phone'] ?? '';
$message = $_GET['message'] ?? $_POST['message'] ?? '';

// Проверка API ключа
if ($api_key !== 'ваш_секретный_ключ') {
    echo json_encode(['success' => false, 'error' => 'Invalid API key']);
    exit;
}

// Отправка SMS через команду (пример для Linux с gammu или smstools)
$phone_clean = preg_replace('/\D/', '', $phone);
$message_escaped = escapeshellarg($message);

// Вариант 1: Через gammu
$command = "gammu sendsms TEXT {$phone_clean} -text {$message_escaped}";

// Вариант 2: Через smstools
// $command = "echo '{$message}' | smstools -s {$phone_clean}";

// Вариант 3: Через curl к другому API
// $command = "curl -X POST 'http://ваш-sms-сервис/api/send' -d 'phone={$phone_clean}&message={$message_escaped}'";

exec($command, $output, $return_code);

if ($return_code === 0) {
    echo json_encode(['success' => true, 'status' => 'sent']);
} else {
    echo json_encode(['success' => false, 'error' => 'Failed to send SMS']);
}
?>
```

### Пример Node.js скрипта (sms_gateway.js)

```javascript
const express = require('express');
const { exec } = require('child_process');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/send', async (req, res) => {
  const { api_key, phone, message } = req.body;
  
  // Проверка API ключа
  if (api_key !== process.env.SMS_GATEWAY_API_KEY) {
    return res.json({ success: false, error: 'Invalid API key' });
  }
  
  const phoneClean = phone.replace(/\D/g, '');
  
  // Отправка через команду (адаптируйте под ваш SMS gateway)
  const command = `gammu sendsms TEXT ${phoneClean} -text "${message}"`;
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Ошибка отправки SMS:', error);
      return res.json({ success: false, error: error.message });
    }
    
    res.json({ success: true, status: 'sent' });
  });
});

app.listen(8080, () => {
  console.log('SMS Gateway запущен на порту 8080');
});
```

## Вариант 2: Использование готового SMS Gateway

Если у вас уже есть SMS gateway на сервере, просто укажите его URL.

## Настройка в проекте

1. Создайте файл `backend/.env` и добавьте:

```env
SMS_SERVICE=local
SMS_GATEWAY_URL=http://localhost:8080/send
SMS_GATEWAY_API_KEY=ваш_секретный_ключ
SMS_GATEWAY_METHOD=POST
```

Или если ваш gateway использует GET:

```env
SMS_SERVICE=local
SMS_GATEWAY_URL=http://ваш-сервер.com/sms/send.php
SMS_GATEWAY_API_KEY=ваш_секретный_ключ
SMS_GATEWAY_METHOD=GET
```

## Формат запроса

### POST запрос:
```json
{
  "api_key": "ваш_секретный_ключ",
  "phone": "996555123456",
  "message": "Ваш код подтверждения для America Pizza: 1234",
  "code": "1234"
}
```

### GET запрос:
```
http://ваш-сервер.com/sms/send.php?api_key=ключ&phone=996555123456&message=текст&code=1234
```

## Формат ответа

Ваш SMS gateway должен возвращать JSON в одном из форматов:

**Успех:**
```json
{"success": true}
```
или
```json
{"status": "success"}
```
или
```json
{"status": "sent"}
```

**Ошибка:**
```json
{"success": false, "error": "описание ошибки"}
```

## Примеры SMS Gateway

### 1. Gammu (Linux)
```bash
# Установка
sudo apt-get install gammu

# Настройка /etc/gammurc
[gammu]
device = /dev/ttyUSB0
connection = at115200

# Отправка
gammu sendsms TEXT 996555123456 -text "Ваш код: 1234"
```

### 2. SMS Tools
```bash
# Установка
sudo apt-get install smstools

# Отправка
echo "Ваш код: 1234" | smstools -s 996555123456
```

### 3. HTTP API к другому сервису
Если у вас есть доступ к API оператора (Beeline, Megacom, O!), используйте их API.

## Тестирование

1. Запустите ваш SMS gateway
2. Проверьте доступность: `curl http://localhost:8080/send`
3. Настройте переменные в `.env`
4. Перезапустите backend
5. Протестируйте отправку кода в приложении

## Безопасность

⚠️ **ВАЖНО:**
- Используйте HTTPS для SMS gateway
- Храните API ключ в секрете
- Ограничьте доступ к gateway только с вашего backend сервера
- Используйте firewall для защиты порта

