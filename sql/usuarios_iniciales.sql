-- PostgreSQL 18. Ejecutar después de sql/schema.sql (o de manage.py migrate) y
-- después de sql/seed.sql. Alternativa manual a "manage.py seed", que crea los
-- mismos usuarios leyendo SEED_ADMIN_USER/SEED_ADMIN_PASSWORD/SEED_CAJERO_USER/
-- SEED_CAJERO_PASSWORD de .env. No sobrescribe registros existentes.
--
-- Credenciales por defecto (cambialas antes de un despliegue real):
--   administrador / admin123
--   cajero        / cajero123
--
-- Los hashes de abajo son pbkdf2_sha256 (el formato de Django), generados con
-- hashlib.pbkdf2_hmac de la libreria estandar de Python; no dependen de tener
-- Django instalado para generarse, pero Django los valida igual al iniciar
-- sesion porque el algoritmo e iteraciones van codificados en el propio hash.
-- Si cambiaste las contraseñas por variable de entorno, usa "manage.py seed"
-- en lugar de este archivo para que los hashes coincidan.
INSERT INTO usuarios (id, usuario, password_hash, rol) VALUES
('50000000-0000-4000-8000-000000000001', 'admin', 'pbkdf2_sha256$600000$2c1efab6a7de$pbssmGWe4CM6ALnotyNdNr1Npl7dnPREss2dZqATRUw=', 'administrador'),
('50000000-0000-4000-8000-000000000002', 'cajero', 'pbkdf2_sha256$600000$c2ab2e647aea$ID2qVAvEyKgdjh0o9hheDura4fROla2XNXNt0HDTDkE=', 'cajero')
ON CONFLICT DO NOTHING;
INSERT INTO seed_history (version, applied_at) VALUES ('usuarios-v1', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
