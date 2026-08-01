-- Раздельный учёт копий по хранилищам.
--
-- Копия может быть не одна: локальная на постоянном диске плюс копия на
-- Google Drive. У каждой свой набор уже загруженного и свои идентификаторы
-- файлов, поэтому инкрементальность нельзя вести по одному ключу на всех.
--
-- Существующие записи принадлежат локальной копии — отсюда значение по умолчанию.

ALTER TABLE "BackupRun" ADD COLUMN "transport" TEXT NOT NULL DEFAULT 'local-drive';

ALTER TABLE "BackupObject" ADD COLUMN "transport" TEXT NOT NULL DEFAULT 'local-drive';

-- Ключ сам по себе больше не уникален: один и тот же объект живёт в обеих копиях
DROP INDEX IF EXISTS "BackupObject_key_key";
CREATE UNIQUE INDEX "BackupObject_transport_key_key" ON "BackupObject" ("transport", "key");
