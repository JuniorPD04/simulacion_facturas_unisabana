# Papel y Luna · Django y PostgreSQL 18

POS de papelería con el frontend existente en HTML/CSS/JavaScript y una API Django conectada exclusivamente a PostgreSQL. Incluye ventas abiertas, facturas, compras, inventario, clientes, proveedores y categorías. El ZIP de la actividad 09 se tomó como referencia de Django/ORM; los ejemplos de juego se adaptaron al dominio de facturación.

Integrantes: Junior Perez Davila, Claudia Libertad Quispe Terrones y Samuel Andres Zona Malaver.

## Ejecutar

Requisitos: Python 3.10 o superior, PostgreSQL **18** instalado y encendido, y acceso a Internet en el primer arranque para instalar las dependencias.

1. Copia `.env.example` como `.env` y configura `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` y `DB_NAME` con tus datos locales. No subas `.env` a Git.
2. Desde la raíz ejecuta:

   ```powershell
   py run.py
   ```

3. Abre **http://127.0.0.1:8000**. Detén el servicio con `Ctrl+C`.

`run.py` crea `.venv`, instala las versiones de `requirements.lock.txt` cuando hace falta, verifica PostgreSQL 18, crea la base si no existe, aplica migraciones, carga el seed una sola vez e inicia frontend y API en el mismo puerto. No necesitas activar el entorno virtual. Si no has definido contraseña, la pide de forma oculta en una terminal interactiva. El usuario de PostgreSQL necesita `CREATEDB` solamente si la base todavía no existe; también puedes crearla previamente con pgAdmin.

```powershell
Copy-Item .env.example .env
# Editar .env con tus credenciales locales
py run.py --check       # Preparar base, migrar, sembrar y verificar sin servidor
py run.py --no-seed     # Iniciar sin cargar ejemplos
```

No abras `index.html` con doble clic ni con Live Server: las llamadas `/api/` se resuelven en el servidor Django. Los datos de `js/config.js` personalizan el comercio en las facturas.

Si `python` apunta al alias de Microsoft Store, usa `py run.py` o el ejecutable real de Python. Si falla la conexión, comprueba el servicio PostgreSQL, puerto, contraseña y privilegios. Para diagnosticar Django, una vez instalado el entorno:

```powershell
.venv/Scripts/python.exe manage.py check --database default
.venv/Scripts/python.exe manage.py migrate --fake-initial
```

## Estructura y actividad 10

| Archivo/carpeta | Responsabilidad |
| --- | --- |
| `facturacion/models.py` | Entidades ORM, relaciones, restricciones y `RequestLog` |
| `facturacion/controllers/` | Controladores por recurso y diagnósticos HTTP |
| `facturacion/validators.py` | Serializers DRF: tipos JSON, campos requeridos, formatos, rangos y referencias |
| `facturacion/services.py` | Negocio: totales, inventario, reintentos y transacciones |
| `facturacion/serializers.py` | Representación de salida compatible con el frontend |
| `facturacion/middleware.py` | Preprocesamiento de logging y postprocesamiento de JSON |
| `facturacion/migrations/` | Historial versionado del esquema |
| `sql/schema.sql` | Esquema PostgreSQL generado desde la migración inicial |
| `sql/seed.sql` | Datos de ejemplo separados, sin sobrescribir existentes |
| `postman/actividad_10.postman_collection.json` | 27 solicitudes y 41 aserciones para la demostración |

El ciclo de solicitud es: cliente → logging → controlador → validator → servicio → ORM/PostgreSQL → controlador → sanitización → cliente. Los validators se invocan desde el servicio antes de modificar datos; son reutilizables y no son middlewares. Logging registra método, ruta, IP y fecha **antes** de llamar al controlador, incluyendo solicitudes inválidas y archivos estáticos. La ruta se limita a 255 caracteres y no se guardan cuerpos, contraseñas ni encabezados.

La sanitización elimina recursivamente claves terminadas en `_id` de objetos y listas JSON, preservando `id` y las relaciones públicas `categoriaId`, `clienteId`, `proveedorId` y `productoId`. El controlador de productos genera `categoria_id` y `categoriaId`: la respuesta HTTP conserva únicamente el segundo. `/api/demo/sanitizacion/` permite demostrar el mismo efecto con datos anidados. Los arrays guardados en `itemsJson` son texto JSON, conservado por compatibilidad; sus claves públicas no tienen sufijo `_id`.

Django aplica los middlewares en orden de arriba a abajo en request y de abajo a arriba en response. Ambos están registrados en `backend/settings.py`.

## Contrato de la API

Base: `http://127.0.0.1:8000/api/`. Cuerpos de escritura con `Content-Type: application/json`.

Para cada recurso `categorias`, `clientes`, `proveedores`, `productos`, `ventas` y `compras`:

| Método y ruta | Operación |
| --- | --- |
| `GET /api/{recurso}/` | Listado |
| `POST /api/{recurso}/` | Crear (201); `id` UUID opcional |
| `GET /api/{recurso}/{uuid}/` | Detalle |
| `PUT /api/{recurso}/{uuid}/` | Actualizar con todos los campos requeridos |
| `PATCH /api/{recurso}/{uuid}/` | Actualización parcial, utilizada por el frontend |
| `DELETE /api/{recurso}/{uuid}/` | Eliminar si las reglas y referencias lo permiten |

Respuestas: `{"success":true,"data":...}`. Los errores usan `{"success":false,"message":"...","errors":{...}}`; `errors` se incluye cuando hay detalles disponibles. Códigos: 400 datos inválidos, 404 inexistente, 405 método incorrecto, 409 duplicados/referencias/documentos contabilizados y 415 formato no admitido. Si la base no permite registrar la llamada, el middleware devuelve 503.

Los endpoints de listado devuelven todos los registros en esta aplicación de pruebas. `/api/request-logs/` devuelve los 100 logs más recientes, incluyendo el de esa misma solicitud; `/api/health/` verifica conexión y versión. La API local del taller no requiere autenticación. No exponer este servidor de desarrollo a Internet.

### Campos de entrada

- Categoría: `nombre` (texto obligatorio, máximo 120).
- Cliente/proveedor: `nombre` (máximo 150), `telefono` opcional (máximo 40), `correo` opcional válido.
- Producto: `codigo`, `nombre`, `categoriaId` existente, `precio`, `costo`, `seguimientoInventario` booleano, `stock` entero. Los valores monetarios son pesos enteros no negativos; stock y precios tienen máximo 2147483647. Si no se sigue inventario, stock queda en 0.
- Venta: `fecha` ISO con hora, `estado` (`abierta`/`cerrada`), `metodoPago` (`Efectivo`/`Nequi`/`Debe`), `valorRecibido`, `clienteId` opcional (UUID, vacío o null), `itemsJson`.
- Compra: `fecha` (`YYYY-MM-DD`), `proveedorId` existente, `itemsJson`.
- `itemsJson`: string con un arreglo de 1 a 500 objetos con `productoId` y `cantidad` entera positiva. Compra exige además `costo`. Se aceptan `codigo`, `nombre`, `precio`, `costo` enviados por el frontend; el servidor toma nombre/código y precios de venta del catálogo. Las compras conservan el costo ingresado.

Los validators rechazan campos desconocidos, strings en lugar de números, booleanos en lugar de enteros, UUID inválidos, productos repetidos, cantidades negativas, correos incorrectos y referencias inexistentes. PUT valida todos los campos requeridos; PATCH combina los datos con el registro persistido y vuelve a validar las reglas de negocio.

### Inventario e integridad

Las ventas abiertas no descuentan stock. Cerrar una venta calcula sus importes en el servidor y descuenta stock una sola vez. `Debe` requiere cliente al cerrar; efectivo debe cubrir el total. Las compras suman stock y actualizan costo. Los documentos guardan detalles relacionales con instantáneas de los productos, para que una edición posterior del catálogo no cambie facturas anteriores.

Todas las escrituras utilizan `transaction.atomic`, un bloqueo transaccional de PostgreSQL para este POS de pruebas y bloqueos de filas de productos. Dos cierres simultáneos no pueden vender el mismo stock. Un error revierte tanto documento como inventario. Este bloqueo global prioriza consistencia para el taller; serializa las escrituras y no está pensado para alto tráfico.

Ventas cerradas y compras no se pueden editar ni eliminar. Reenviar el mismo documento contabilizado con su UUID devuelve el registro existente sin repetir movimientos. Para reintentar un POST de forma segura, conserva el UUID generado por el frontend: sin `id`, cada POST crea un documento nuevo. Los totales enviados por el cliente son campos calculados: se ignoran y se devuelven los valores del servidor. Eliminar categorías/contactos/productos referenciados devuelve 409.

## SQL independiente

La opción recomendada es `py run.py`, que usa migraciones. Para cargar los archivos manualmente en una **base vacía** de PostgreSQL 18:

```powershell
psql -h 127.0.0.1 -U postgres -d papel_y_luna -v ON_ERROR_STOP=1 -f sql/schema.sql
psql -h 127.0.0.1 -U postgres -d papel_y_luna -v ON_ERROR_STOP=1 -1 -f sql/seed.sql
py run.py
```

También puedes ejecutarlos desde Query Tool en pgAdmin. `schema.sql` incluye su propia transacción. No ejecutarlo en una base ya migrada. `run.py` reconoce la instalación inicial mediante `--fake-initial` internamente. `seed_history` evita que el arranque vuelva a insertar ejemplos que hayas eliminado. `seed.sql` puede ejecutarse varias veces sin actualizar filas existentes; para no restaurar ejemplos eliminados usa el comando protegido `manage.py seed`.

Para regenerar el esquema desde las migraciones:

```powershell
.venv/Scripts/python.exe manage.py sqlmigrate facturacion 0001 | Out-File sql/schema.sql -Encoding utf8
```

## Demostración y pruebas

Importa `postman/actividad_10.postman_collection.json` en Postman. Define `baseUrl=http://127.0.0.1:8000` y ejecuta la colección en orden. Crea sus propias categorías/productos y documentos de demostración: usa una base de pruebas.

```powershell
postman collection run postman/actividad_10.postman_collection.json --env-var baseUrl=http://127.0.0.1:8000
.venv/Scripts/python.exe manage.py test facturacion --noinput
node --test tests/mvp2.test.cjs
```

Las pruebas Django crean y destruyen una base `test_<DB_NAME>`: el usuario debe poder crear bases. Cubren CRUD, validadores, ambos middlewares, protección de archivos privados, reintentos, rollback y compras simultáneas. Las pruebas JavaScript conservan la cobertura del store y del backend histórico simulado; la integración con el backend nuevo se verifica adicionalmente contra HTTP real:

```powershell
$env:TEST_API_URL='http://127.0.0.1:8000'
node tests/django-integration.cjs
```

Este último comando también crea documentos; dirigirlo a una base de pruebas. La guía de exposición y repaso conceptual está en `docs/actividad_10.md`; la evidencia de validación, en `docs/verificacion.md`.

Para generar el ZIP entregable (sin `.env`, `.venv`, cachés ni bases):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

`apps-script.gs` y `docs/legacy_apps_script.md` se conservan como referencia de la versión anterior; el frontend actual utiliza exclusivamente Django. Esta adaptación no importa automáticamente los datos históricos de Google Sheets.

Referencias técnicas: [Django y PostgreSQL](https://docs.djangoproject.com/en/5.2/ref/databases/), [middlewares de Django](https://docs.djangoproject.com/en/5.2/topics/http/middleware/) y [CREATE DATABASE en PostgreSQL 18](https://www.postgresql.org/docs/18/sql-createdatabase.html).
