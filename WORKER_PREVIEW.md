# Preview API через Cloudflare Worker

Этот Worker нужен только для `lyubimoe-site-preview`: браузер больше не ходит напрямую в `*.supabase.co`, а обращается к `https://preview-api.bibizana-chi.ru`.

## 1. Подготовить Cloudflare

1. Проверить, где управляется DNS `bibizana-chi.ru`.
2. Если домен уже в Cloudflare, добавить Worker route или custom domain для `preview-api.bibizana-chi.ru`.
3. Если домен не в Cloudflare, временно можно поднять Worker на `*.workers.dev`, а потом перенести на `preview-api.bibizana-chi.ru`.

## 2. Создать Worker

Скопировать `worker/wrangler.toml.example` в `worker/wrangler.toml`.

Секреты добавить через Wrangler или Cloudflare Dashboard:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SESSION_SECRET
```

`SUPABASE_SERVICE_ROLE_KEY` берётся в Supabase: Project Settings -> API Keys -> Secret keys. Его нельзя добавлять в frontend.

`SESSION_SECRET` — любая длинная случайная строка, например 32+ символа.

## 3. Deploy

Из папки `worker`:

```bash
wrangler deploy
```

После деплоя привязать Worker к:

```text
preview-api.bibizana-chi.ru/*
```

## 4. Проверка

1. Открыть `https://preview-api.bibizana-chi.ru/auth/join` в браузере: GET должен вернуть ошибку, это нормально.
2. Открыть preview сайт без VPN.
3. Войти фразой `антон и катя`.
4. Проверить воспоминания, галерею, загрузку и удаление.

## 5. Что изменилось в frontend

- `supabase-config.js` теперь содержит `window.LYUBIMOE_API`.
- Supabase JS SDK больше не подключается в preview frontend.
- Realtime временно заменён polling раз в 15 секунд.
- Картинки галереи открываются через `/gallery/file/:id`, а не через Supabase Storage URL.
