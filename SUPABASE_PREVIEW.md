# Supabase preview setup

Этот файл нужен только для `lyubimoe-site-preview`.

## 1. Создать project

В Supabase создайте новый project и включите anonymous sign-ins:

`Authentication` -> `Sign In / Providers` -> `Anonymous Sign-Ins`.

## 2. Выполнить SQL

Откройте `SQL Editor` и выполните содержимое `supabase-setup.sql`.

SQL создаёт:

- комнату `preview` с фразой `антон и катя`;
- таблицы галереи, воспоминаний и будущих игровых сессий;
- Storage bucket `gallery` с публичными файлами по прямой ссылке;
- RLS policies;
- RPC `join_room`;
- Realtime publication для `gallery_items` и `memories`.

## 3. Если SQL уже выполнялся раньше

Если `supabase-setup.sql` уже выполнялся, запустите его ещё раз. Он обновит bucket `gallery` в public-режим, не удаляя данные.

## 4. Заполнить конфиг

В `supabase-config.js` вставьте публичные значения проекта:

```js
window.LYUBIMOE_SUPABASE = {
  url: "https://...supabase.co",
  anonKey: "...",
  roomSlug: "preview"
};
```

После этого запушьте preview-ветку в `lyubimoe-site-preview`.
