-- Audit logs are append-only: reject UPDATE and DELETE at the database level, whatever the caller.
-- (MySQL/MariaDB triggers do not fire for TRUNCATE or DROP; those are privileged DDL statements.
--  Use a runtime database account without DROP/ALTER where the host allows it. See docs/security.md.)

CREATE TRIGGER `audit_logs_prevent_update`
BEFORE UPDATE ON `audit_logs`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: UPDATE is not permitted';

CREATE TRIGGER `audit_logs_prevent_delete`
BEFORE DELETE ON `audit_logs`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: DELETE is not permitted';
