# Preview API на VPS

Этот вариант нужен для `lyubimoe-site-preview`: общая лента и галерея работают через обычный VPS, без Supabase и Cloudflare Worker.

## 1. Сервер

Рекомендуемый минимум:

- Ubuntu 24.04
- 1 vCPU
- 1 GB RAM
- 10-20 GB disk
- российский дата-центр

Подойдут Timeweb Cloud, Selectel, REG.Cloud или другой VPS, который стабильно открывается без VPN из России.

## 2. DNS

Для `preview-api.bibizana-chi.ru` нужна обычная A-запись на IP VPS:

```text
preview-api.bibizana-chi.ru -> VPS_IP
```

Если DNS ведётся через Cloudflare, proxy должен быть выключен: серое облако / DNS only. Если резолвинг снова ведёт себя странно, проще вернуть NS домена на REG.RU и создать A-запись там.

## 3. Установка Docker

На чистом Ubuntu-сервере:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 4. Деплой API

Скопировать папку `server/` на VPS, например в `/opt/lyubimoe-preview-api`.

```bash
cd /opt/lyubimoe-preview-api
cp .env.example .env
nano .env
```

В `.env` обязательно заменить:

```text
SESSION_SECRET=change-this-to-a-long-random-secret
```

Запуск:

```bash
sudo docker compose up -d --build
sudo docker compose logs -f
```

## 5. Проверка

До DNS можно проверить API по IP:

```bash
curl http://127.0.0.1:8000/health
```

После DNS:

```bash
curl https://preview-api.bibizana-chi.ru/health
```

Ожидаемый ответ:

```json
{"status":"ok"}
```

`GET /auth/join` должен вернуть ошибку, потому что вход делается POST-запросом с фразой.

## 6. Резервная копия

Данные живут в:

```text
server/data/preview.sqlite3
server/uploads/gallery/
```

Для бэкапа достаточно архивировать `data/` и `uploads/`.
