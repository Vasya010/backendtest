<?php
/**
 * Простой пример SMS Gateway на PHP
 * Разместите этот файл на вашем сервере (например: /var/www/sms_gateway.php)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// Настройки
$API_KEY = getenv('SMS_GATEWAY_API_KEY') ?: 'your_secret_key_here';

// Получаем данные
$method = $_SERVER['REQUEST_METHOD'];
$api_key = $method === 'POST' ? ($_POST['api_key'] ?? '') : ($_GET['api_key'] ?? '');
$phone = $method === 'POST' ? ($_POST['phone'] ?? '') : ($_GET['phone'] ?? '');
$message = $method === 'POST' ? ($_POST['message'] ?? '') : ($_GET['message'] ?? '');
$code = $method === 'POST' ? ($_POST['code'] ?? '') : ($_GET['code'] ?? '');

// Проверка API ключа
if ($api_key !== $API_KEY) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Invalid API key']);
    exit;
}

// Проверка обязательных полей
if (empty($phone) || empty($message)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Phone and message are required']);
    exit;
}

// Функция отправки SMS (адаптируйте под ваш способ)
function sendSMS($phone, $message) {
    // ВАРИАНТ 1: Через gammu
    // $command = "gammu sendsms TEXT {$phone} -text " . escapeshellarg($message);
    // exec($command, $output, $return_code);
    // return $return_code === 0;
    
    // ВАРИАНТ 2: Через curl к API оператора
    // $url = "https://api.operator.kg/sms/send";
    // $data = ['phone' => $phone, 'message' => $message];
    // $ch = curl_init($url);
    // curl_setopt($ch, CURLOPT_POST, 1);
    // curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    // curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    // curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json', 'Authorization: Bearer YOUR_TOKEN']);
    // $result = curl_exec($ch);
    // curl_close($ch);
    // return json_decode($result, true)['success'] ?? false;
    
    // ВАРИАНТ 3: Через smstools
    // $command = "echo " . escapeshellarg($message) . " | smstools -s {$phone}";
    // exec($command, $output, $return_code);
    // return $return_code === 0;
    
    // ПРИМЕР: Логирование (замените на реальную отправку)
    error_log("SMS to {$phone}: {$message}");
    
    // Здесь должна быть реальная отправка SMS
    // Пока возвращаем true для тестирования
    return true;
}

// Отправка SMS
$result = sendSMS($phone, $message);

if ($result) {
    echo json_encode([
        'success' => true,
        'status' => 'sent',
        'phone' => $phone
    ]);
} else {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Failed to send SMS'
    ]);
}
?>



