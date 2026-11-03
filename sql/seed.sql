-- PostgreSQL 18. Ejecutar después del esquema o de manage.py migrate.
-- No sobrescribe registros existentes. Usar una transacción desde el cliente.
INSERT INTO categorias (id, nombre) VALUES
('10000000-0000-4000-8000-000000000001', 'Cuadernos'),
('10000000-0000-4000-8000-000000000002', 'Escritura'),
('10000000-0000-4000-8000-000000000003', 'Servicios') ON CONFLICT DO NOTHING;
INSERT INTO clientes (id, nombre, telefono, correo) VALUES
('20000000-0000-4000-8000-000000000001', 'Ana Torres', '3001234567', 'ana@example.com') ON CONFLICT DO NOTHING;
INSERT INTO proveedores (id, nombre, telefono, correo) VALUES
('30000000-0000-4000-8000-000000000001', 'Distribuidora Escolar', '6015551234', 'ventas@example.com') ON CONFLICT DO NOTHING;
INSERT INTO productos (id, codigo, nombre, categoria_id, precio, costo, seguimiento_inventario, stock) VALUES
('40000000-0000-4000-8000-000000000001', 'PL-001', 'Cuaderno cuadriculado', '10000000-0000-4000-8000-000000000001', 8500, 5000, true, 30),
('40000000-0000-4000-8000-000000000002', 'PL-002', 'Lapicero azul', '10000000-0000-4000-8000-000000000002', 2000, 900, true, 100),
('40000000-0000-4000-8000-000000000003', 'PL-003', 'Impresion blanco y negro', '10000000-0000-4000-8000-000000000003', 300, 100, false, 0) ON CONFLICT DO NOTHING;
INSERT INTO seed_history (version, applied_at) VALUES ('initial-v1', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
