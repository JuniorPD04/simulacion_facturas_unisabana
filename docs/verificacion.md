# Evidencia de verificación · 3 de noviembre de 2026

Se usó una instancia temporal real de **PostgreSQL 18**, escuchando únicamente en `127.0.0.1:55432`, aislada del servicio habitual en 5432. No se usó SQLite ni un mock para las pruebas Django o la colección Postman.

| Verificación | Resultado |
| --- | --- |
| `run.py --check` desde una base inexistente | Crea base, migra, carga seed y pasa `check` |
| Segundo arranque | No repite migraciones ni seed |
| Suite Django | 18 pruebas: CRUD, entrada estricta, logging, sanitización, referencias, rollback, seed y concurrencia |
| Suite JavaScript existente | 14 pruebas aprobadas; mantiene cobertura del store y del backend histórico simulado |
| Integración HTTP `tests/django-integration.cjs` | Store real del frontend → API real → PostgreSQL; venta abierta, cierre, reintento, compra y CRUD aprobados |
| Colección Postman | 27 solicitudes, 41 aserciones, 0 fallos |
| Instalación manual de schema y seed | Esquema aplicable en base vacía y reconocido por migraciones iniciales |
| Empaquetado | Incluye backend, SQL, colección y documentación; excluye secretos, entorno virtual y datos de pruebas |

El test de concurrencia envía dos cierres simultáneos por cuatro unidades cuando sólo hay cinco disponibles: uno se acepta y el otro se rechaza; stock final uno. La prueba de rollback provoca un fallo al guardar el detalle después de modificar stock: ni la venta ni el movimiento quedan persistidos.

La colección se ejecutó contra `http://127.0.0.1:8018` con Postman CLI 1.75.0, sin publicar resultados en un workspace. El reporte completo queda en `.tmp-tools/postman-actividad10.json` en el entorno de trabajo, excluido del ZIP.

La versión instalada del CLI permite ejecutar esta colección local, pero no dispone del comando `postman status`; no se creó ni se vinculó un workspace remoto.

Las pruebas HTTP utilizan los mismos módulos JavaScript de datos del frontend; no se ejecutó una comprobación visual automatizada del navegador. La configuración del usuario en el servicio habitual depende de sus credenciales en `.env` y no se modificó para las pruebas.
