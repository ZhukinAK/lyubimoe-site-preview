# Supabase + Worker preview setup

Этот файл нужен только для `lyubimoe-site-preview`.

## 1. Создать project

В Supabase создайте project. Anonymous sign-ins для frontend больше не нужны: preview-сайт ходит через Cloudflare Worker.

## 2. Выполнить SQL

Откройте `SQL Editor` и выполните содержимое `supabase-setup.sql`.

SQL создаёт:

- комнату `preview` с фразой `антон и катя`;
- таблицы галереи, воспоминаний и будущих игровых сессий;
- приватный Storage bucket `gallery`;
- RLS policies;
- RPC `join_room`;
- Realtime publication для `gallery_items` и `memories`.

Preview frontend больше не ходит в Supabase напрямую для общей комнаты. Таблицы и Storage остаются в Supabase, но браузер обращается к Cloudflare Worker `preview-api.bibizana-chi.ru`.

## 3. Cloudflare Worker

См. `WORKER_PREVIEW.md`. В Worker нужно добавить secret `SUPABASE_SERVICE_ROLE_KEY`; в frontend этот ключ добавлять нельзя.

## 4. Заполнить конфиг

В `supabase-config.js` вставьте публичный URL preview API:

```js
window.LYUBIMOE_API = {
  url: "https://preview-api.bibizana-chi.ru",
  roomSlug: "preview"
};
```

После этого запушьте preview-ветку в `lyubimoe-site-preview`.
